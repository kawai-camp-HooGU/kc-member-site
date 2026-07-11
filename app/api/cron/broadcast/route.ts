import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { runBroadcast } from "../../../../lib/broadcastSend";

// 予約配信の送信。Vercel Cron から定期的に呼ぶ（例: 毎分 vercel.json "* * * * *"）。
//   scheduled かつ scheduled_at <= now の配信を送信する。
export async function GET(request: Request) {
  try {
    // fail-closed（CRON_SECRET 未設定なら誰も叩けない）
    requireCron(request);

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
    return errorResponse(err);
  }
}
