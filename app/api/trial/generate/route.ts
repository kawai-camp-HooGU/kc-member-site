// ============================================================
// POST /api/trial/generate — 成果物を作る（公開・ログイン不要）
//
//   ★ 受付と生成を分ける（設計 §7-5）。
//     上限を判定して run を running に倒したら 202 を返し、生成は続けて走らせる。
//     画面は /api/trial/status をポーリングして完成を待つ。
//     画像生成（段階2）は数十秒かかるため、ここで待つと関数の実行時間に触れる。
//
//   ⚠️ 上限を通す前に外部APIを呼ばない。
//   ⚠️ 回数は生成の前に +1 する。失敗しても減らさない
//      （減らすと、失敗を繰り返させて無限に生成できてしまう）。
// ============================================================
import { NextResponse } from "next/server";
import { errorResponse, HttpError } from "../../../../lib/authz";
import {
  gateGeneration, loadRun, markRunning, normalizeInputs, pickStep, runGeneration,
  visitorCookieHeader, MAX_INSTRUCTION,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialGenerateReq, TrialGenerateRes } from "../../../../lib/bot/trial/types";
import { resolveTrialCtx } from "../../../../lib/bot/trial/trialEntry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as TrialGenerateReq;
    const ctx = await resolveTrialCtx(request, {
      shareToken: body.shareToken, passcode: body.passcode,
    });

    // ⚠️ share_token 一致を条件に読む（他URLの run を触らせない）
    const run = await loadRun(Number(body.runId), ctx.link.token);
    if (!run) throw new HttpError(404, "この体験は見つかりませんでした。");
    if (run.status === "running") throw new HttpError(409, "いま作成中です。少しお待ちください。");
    if (run.submitted_at) throw new HttpError(409, "この体験はすでに提出済みです。");

    const instruction = (body.instruction ?? "").trim().slice(0, MAX_INSTRUCTION);
    const isRevise = instruction !== "";

    // 調整回数の上限（生成の上限とは別。こちらは体験の質のための制限）
    const reviseLimit = ctx.settings.reviseLimit ?? ctx.scenario.revise_limit;
    if (isRevise && run.revise_count >= reviseLimit) {
      throw new HttpError(429, `調整できる回数の上限（${reviseLimit}回）に達しました。`);
    }

    const step = pickStep(ctx.scenario, run.step_key);
    // 初回は入力値を確定させる。調整のときは保存済みの値を使い回す。
    const inputs = isRevise
      ? run.inputs
      : normalizeInputs(step.inputs ?? [], body.inputs ?? null);

    // ── 3層の上限。ここを通ったら +1 される ──
    const gate = await gateGeneration(ctx.link, ctx.settings, {
      deviceKey: ctx.deviceKey, ipKey: ctx.ipKey,
    });

    // ⚠️ compare-and-swap。1行も当たらなければ、別のリクエストが先に走っている。
    //    ここで弾かないと、同時クリックで外部APIが2回課金される。
    const accepted = await markRunning(run.id, {
      inputs: isRevise ? undefined : inputs,
      stepKey: step.key,
      isRevise,
      genCount: run.gen_count,
      reviseCount: run.revise_count,
    });
    if (!accepted) throw new HttpError(409, "いま作成中です。少しお待ちください。");

    // ★ await しない。完成は status のポーリングで拾う。
    //   ⚠️ 実行環境によっては「返してから続きを走らせる」が途中で止まる。
    //      §13-1 A のとおり、実測して動かなければ await に切り替える
    //      （画面の作りは変わらない）。
    void runGeneration({
      run: { ...run, inputs, step_key: step.key },
      scenario: ctx.scenario,
      step,
      inputs,
      instruction,
      subjectKey: ctx.deviceKey,
      isRevise,
      quality: ctx.settings.quality,
    });

    const payload: TrialGenerateRes = {
      runId: run.id,
      status: "running",
      remainingGen: gate.remainingGen,
    };
    const res = NextResponse.json(payload, { status: 202 });
    if (ctx.isNewVisitor) res.headers.set("Set-Cookie", visitorCookieHeader(ctx.visitorId));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
