import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";
import { runBroadcast } from "../../../../lib/broadcastSend";

// 予約配信の送信。Vercel Cron から定期的に呼ぶ（例: 毎分 vercel.json "* * * * *"）。
//   scheduled かつ scheduled_at <= now の配信を送信する。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const nowIso = new Date().toISOString();
    const { data: due } = await supabaseAdmin
      .from("broadcasts")
      .select("id")
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso);
    const ids = (due ?? []).map((d) => d.id);
    const results: { id: number; ok: boolean; count: number }[] = [];
    for (const id of ids) {
      const r = await runBroadcast(id);
      results.push({ id, ok: r.ok, count: r.recipientCount });
    }
    return NextResponse.json({ ran: nowIso, processed: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
