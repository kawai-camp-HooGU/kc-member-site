// ============================================================
// メール機微データの定期パージ（Vercel Cron・情報漏洩対策）
//   GET /api/cron/mail-purge → { ran, result }
//   古い本文キャッシュ（body_text/html）と、完了した送信予約を削除する。
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { purgeMailData } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const result = await purgeMailData();
    return NextResponse.json({ ran: new Date().toISOString(), result });
  } catch (err) {
    return errorResponse(err);
  }
}
