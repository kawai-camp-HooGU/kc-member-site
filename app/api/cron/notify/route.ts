import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { buildNotifications, sendChatwork, categoriesForWeekday, jstDateStr } from "../../../../lib/notify";
import { requireCron, errorResponse, HttpError } from "../../../../lib/authz";

interface SendResult { project: string; roomId: string; ok: boolean; error: string | null; }

// Vercel Cron から毎日呼ばれる（JST 9時想定 = vercel.json で 0 0 * * * = UTC0時）。
export async function GET(request: Request) {
  try {
    // ── fail-closed ──
    //   以前は CRON_SECRET が未設定だと認証を素通りしていた（誰でも実送信を発火できた）。
    //   未設定なら「誰でも叩ける」ではなく「誰も叩けない」に倒す。
    requireCron(request);

    const token = process.env.CHATWORK_API_TOKEN;
    if (!token) {
      throw new HttpError(500, "CHATWORK_API_TOKEN が未設定です");
    }

    const categories = categoriesForWeekday();
    const items = await buildNotifications(supabaseAdmin, categories);
    const results: SendResult[] = [];
    for (const i of items) {
      const r = await sendChatwork(token, i.roomId, i.message);
      results.push({ project: i.projectName, roomId: i.roomId, ok: r.ok, error: r.ok ? null : r.text });
    }
    return NextResponse.json({ ran: jstDateStr(0), categories, sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err) {
    return errorResponse(err);
  }
}
