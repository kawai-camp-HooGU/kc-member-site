import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { buildNotifications, sendChatwork, buildSampleMessage, fetchAppSettings } from "../../../../lib/notify";
import { errMessage } from "../../../../lib/errors";

interface NotifyBody { categories?: unknown; dryRun?: boolean; }
interface SendResult { project: string; roomId: string; assignee: string | null; ok: boolean; error: string | null; }

// 手動通知（UIから）。dryRun=true でプレビュー、false で実送信。
export async function POST(request: Request) {
  try {
    const { categories, dryRun } = (await request.json()) as NotifyBody;
    if (!Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json({ error: "categories が指定されていません" }, { status: 400 });
    }
    const cats = categories as string[];

    const appSettings = await fetchAppSettings(supabaseAdmin);
    const items = await buildNotifications(supabaseAdmin, cats, { includeEmpty: true, appSettings });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        count: items.length,
        sample: buildSampleMessage(cats, appSettings),
        items: items.map((i) => ({ project: i.projectName, roomId: i.roomId, assignee: i.assigneeName, category: i.category, message: i.message })),
      });
    }

    const token = process.env.CHATWORK_API_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "CHATWORK_API_TOKEN が未設定です" }, { status: 500 });
    }

    const results: SendResult[] = [];
    for (const i of items) {
      const r = await sendChatwork(token, i.roomId, i.message);
      results.push({ project: i.projectName, roomId: i.roomId, assignee: i.assigneeName, ok: r.ok, error: r.ok ? null : r.text });
    }
    return NextResponse.json({ dryRun: false, sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
