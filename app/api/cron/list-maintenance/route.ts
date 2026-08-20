// ============================================================
// リスト管理の夜間メンテナンス（Vercel Cron）
//   GET /api/cron/list-maintenance → { ran, result }
//     ① 取込の失敗行（error_rows）を 30 日で消す（個人情報の保持期間・設計書）
//     ② 会員との名寄せ（member_id が空のレコードを紐づけ直す）
//
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
//   ⚠️ 会員マスタは書き換えない（確定事項 No.12=a）。触るのは
//      contact_list_entries.member_id / matched_by と error_rows だけ。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { runListMaintenance } from "../../../../lib/contactListsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const result = await runListMaintenance();
    return NextResponse.json({ ran: new Date().toISOString(), result });
  } catch (err) {
    return errorResponse(err);
  }
}
