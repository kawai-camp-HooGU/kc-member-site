import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { buildNotifications, sendChatwork, categoriesForWeekday, jstDateStr } from "../../../../lib/notify";
import { errMessage } from "../../../../lib/errors";

interface SendResult { project: string; roomId: string; ok: boolean; error: string | null; }

// Vercel Cron から毎日呼ばれる（JST 9時想定 = vercel.json で 0 0 * * * = UTC0時）。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.CHATWORK_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "CHATWORK_API_TOKEN が未設定です" }, { status: 500 });
  }

  try {
    const categories = categoriesForWeekday();
    const items = await buildNotifications(supabaseAdmin, categories);
    const results: SendResult[] = [];
    for (const i of items) {
      const r = await sendChatwork(token, i.roomId, i.message);
      results.push({ project: i.projectName, roomId: i.roomId, ok: r.ok, error: r.ok ? null : r.text });
    }
    return NextResponse.json({ ran: jstDateStr(0), categories, sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
