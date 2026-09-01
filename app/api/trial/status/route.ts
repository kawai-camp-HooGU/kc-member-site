// ============================================================
// GET /api/trial/status?runId=&shareToken=&passcode= — 進行と最新の成果物
//   ・画面が2秒間隔で叩く（running のあいだだけ）。
//   ・回数は加算しない（peek のみ）。
// ============================================================
import { NextResponse } from "next/server";
import { errorResponse, HttpError } from "../../../../lib/authz";
import {
  latestArtifact, loadRun, peekRemainingGen, revisionHistory,
  toPublicArtifact, toPublicRun,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialStatusRes } from "../../../../lib/bot/trial/types";
import { resolveTrialCtx } from "../../../../lib/bot/trial/trialEntry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await resolveTrialCtx(request, {
      shareToken: url.searchParams.get("shareToken") ?? "",
      passcode: url.searchParams.get("passcode"),
    });

    const run = await loadRun(Number(url.searchParams.get("runId")), ctx.link.token);
    if (!run) throw new HttpError(404, "この体験は見つかりませんでした。");

    const [artifactRow, history, remainingGen] = await Promise.all([
      latestArtifact(run.id),
      revisionHistory(run.id),
      peekRemainingGen(ctx.link.token, ctx.deviceKey, ctx.settings.perUserGenLimit),
    ]);
    const artifact = await toPublicArtifact(artifactRow);

    const reviseLimit = ctx.settings.reviseLimit ?? ctx.scenario.revise_limit;
    const payload: TrialStatusRes = {
      run: toPublicRun(run),
      artifact,
      history,
      remainingGen,
      remainingRevise: Math.max(0, reviseLimit - run.revise_count),
    };
    return NextResponse.json(payload);
  } catch (err) {
    return errorResponse(err);
  }
}
