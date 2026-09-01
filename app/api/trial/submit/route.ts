// ============================================================
// POST /api/trial/submit — 成果物を提出する（公開・ログイン不要）
//
//   ★ 講評は運営が人で返す（設計 決定6b）。返す宛先が要るので、
//     ここで既存のフォーム基盤を通す（設計 §12）。
//     フォームに回答すると外部ロールで会員登録され、その場でログインできる。
//     連絡先を入口では聞かない（決定7）ので、聞くのはこの瞬間だけ。
//
//   ⚠️ 講評はここでは返らない。運営が後から書く。
//   ⚠️ 提出は1回だけ（冪等）。
//   ⚠️ 通知の失敗で提出を落とさない。
// ============================================================
import { NextResponse } from "next/server";
import { errorResponse, HttpError } from "../../../../lib/authz";
import { submitForm } from "../../../../lib/formsServer";
import {
  latestArtifact, loadRun, loadScenarioFormSlug, markSubmitted,
  memberIdOfSubmission, notifyOpsOfSubmission, visitorCookieHeader,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialSubmitReq, TrialSubmitRes } from "../../../../lib/bot/trial/types";
import { resolveTrialCtx } from "../../../../lib/bot/trial/trialEntry";

export const runtime = "nodejs";

const MAX_NAME = 60;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 500;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as TrialSubmitReq;
    const ctx = await resolveTrialCtx(request, {
      shareToken: body.shareToken, passcode: body.passcode,
    });

    // ⚠️ share_token 一致を条件に読む（他URLの run を触らせない）
    const run = await loadRun(Number(body.runId), ctx.link.token);
    if (!run) throw new HttpError(404, "この体験は見つかりませんでした。");
    if (run.submitted_at) throw new HttpError(409, "この体験はすでに提出済みです。");

    const artifact = await latestArtifact(run.id);
    if (!artifact) throw new HttpError(400, "提出できる成果物がまだありません。");

    const slug = await loadScenarioFormSlug(ctx.scenario.form_id);
    if (!slug) throw new HttpError(400, "この体験は提出の受付を設定中です。");

    const name = (body.name ?? "").trim().slice(0, MAX_NAME);
    const email = (body.email ?? "").trim().slice(0, MAX_EMAIL);
    if (!name) throw new HttpError(400, "お名前を入力してください。");
    // 形の検証だけ。到達性は確かめられないので、ここでは弾きすぎない。
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "メールアドレスの形式をご確認ください。");
    }

    // ⚠️ 既存の公開フォームの経路をそのまま通す。
    //    ここで会員登録（member_signup アクション）とワンタイムトークン発行が行われる。
    //    フォームに必須設問があると検証で落ちる。運用手順書に「必須設問を置かない」と明記してある。
    const result = await submitForm({
      slug,
      answers: {},
      guestName: name,
      guestEmail: email,
      channel: "chat",
      token: null,
    });
    if (!result.ok) {
      throw new HttpError(400, result.error ?? "提出を受け付けられませんでした。");
    }

    // ⚠️ 講評の宛先になる。ここで繋がないと段階4で送れない。
    const memberId = await memberIdOfSubmission(result.submissionId ?? null);

    await markSubmitted({
      runId: run.id,
      memberId,
      submissionId: result.submissionId ?? null,
      artifactId: artifact.id,
    });

    // 送りっぱなし。失敗しても提出は成立している。
    void notifyOpsOfSubmission({
      runId: run.id,
      scenarioTitle: ctx.scenario.title,
      linkLabel: ctx.link.label ?? "",
    });

    const payload: TrialSubmitRes = {
      ok: true,
      tokenHash: result.trialTokenHash ?? null,
      submissionId: result.submissionId ?? null,
      message: "提出を受け付けました。担当者が目を通して、講評をお届けします。",
    };
    const res = NextResponse.json(payload);
    if (ctx.isNewVisitor) res.headers.set("Set-Cookie", visitorCookieHeader(ctx.visitorId));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
