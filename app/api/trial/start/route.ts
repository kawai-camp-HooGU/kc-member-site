// ============================================================
// POST /api/trial/start — 体験を開始する（公開・ログイン不要）
//   ・「はじめる」を押した時点で run を作る。
//     画面を開いただけでは作らない（空 run を量産しない）。
//   ・端末キーの Cookie はここで発行する。
// ============================================================
import { NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/authz";
import {
  createRun, peekRemainingGen, pickStep, toPublicRun, toPublicScenario,
  visitorCookieHeader,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialStartReq, TrialStartRes } from "../../../../lib/bot/trial/types";
import { resolveTrialCtx } from "../../../../lib/bot/trial/trialEntry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as TrialStartReq;
    const ctx = await resolveTrialCtx(request, {
      shareToken: body.shareToken, passcode: body.passcode,
    });

    const step = pickStep(ctx.scenario, "");
    const run = await createRun({
      shareToken: ctx.link.token,
      scenarioId: ctx.scenario.id,
      subjectKey: ctx.deviceKey,
      stepKey: step.key,
    });

    const remainingGen = await peekRemainingGen(
      ctx.link.token, ctx.deviceKey, ctx.settings.perUserGenLimit,
    );

    const payload: TrialStartRes = {
      run: toPublicRun(run),
      scenario: toPublicScenario(ctx.scenario, ctx.settings),
      remainingGen,
      remainingRevise: ctx.settings.reviseLimit ?? ctx.scenario.revise_limit,
    };
    const res = NextResponse.json(payload);
    if (ctx.isNewVisitor) res.headers.set("Set-Cookie", visitorCookieHeader(ctx.visitorId));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
