// ============================================================
// メール受信の定期同期（Vercel Cron）
//   GET /api/cron/mail → { ran, results }
//   vercel.json の crons に登録して定時実行する（例: 15分ごと）。
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
//   ⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { isMailConfigured, syncAllMail } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    if (!isMailConfigured()) {
      return NextResponse.json({ ran: new Date().toISOString(), skipped: "MAIL_ACCOUNTS 未設定", results: [] });
    }
    const results = await syncAllMail();
    return NextResponse.json({ ran: new Date().toISOString(), results });
  } catch (err) {
    return errorResponse(err);
  }
}
