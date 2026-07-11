import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { runScenarioCron } from "../../../../lib/scenarioRun";

// シナリオ配信の定期処理（エンロール＋配信）。Vercel Cron から定期実行。
export async function GET(request: Request) {
  try {
    // fail-closed（CRON_SECRET 未設定なら誰も叩けない）
    requireCron(request);

    const r = await runScenarioCron();
    return NextResponse.json({ ran: new Date().toISOString(), ...r });
  } catch (err) {
    return errorResponse(err);
  }
}
