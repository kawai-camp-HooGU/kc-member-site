// ============================================================
// 送信予約メールの定期処理（Vercel Cron）
//   GET /api/cron/mail-scheduled → { ran, result }
//   vercel.json の crons に登録して定時実行する（例: 5分ごと）。
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
//   ⚠️ imapflow/nodemailer は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { runScheduledMail } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const result = await runScheduledMail();
    return NextResponse.json({ ran: new Date().toISOString(), result });
  } catch (err) {
    return errorResponse(err);
  }
}
