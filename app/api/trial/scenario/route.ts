// ============================================================
// GET /api/trial/scenario?shareToken=&passcode= — 体験の説明を取る
//   ・①「体験の説明が表示されている」状態を作るためだけの読み取り。
//   ・⚠️ run を作らない。画面を開いただけで空の run を量産しないため。
//   ・⚠️ テンプレプロンプトは返さない（toPublicScenario が落とす）。
// ============================================================
import { NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/authz";
import {
  peekRemainingGen, toPublicScenario, visitorCookieHeader,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialScenarioPublic } from "../../../../lib/bot/trial/types";
import { resolveTrialCtx } from "../../../../lib/bot/trial/trialEntry";

export const runtime = "nodejs";

export interface TrialScenarioRes {
  scenario: TrialScenarioPublic;
  remainingGen: number;
  remainingRevise: number;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await resolveTrialCtx(request, {
      shareToken: url.searchParams.get("shareToken") ?? "",
      passcode: url.searchParams.get("passcode"),
    });

    const remainingGen = await peekRemainingGen(
      ctx.link.token, ctx.deviceKey, ctx.settings.perUserGenLimit,
    );

    const payload: TrialScenarioRes = {
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
