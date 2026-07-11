import { NextResponse } from "next/server";
import { errMessage } from "../../../../lib/errors";
import { runScenarioCron } from "../../../../lib/scenarioRun";

// シナリオ配信の定期処理（エンロール＋配信）。Vercel Cron から定期実行。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runScenarioCron();
    return NextResponse.json({ ran: new Date().toISOString(), ...r });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
