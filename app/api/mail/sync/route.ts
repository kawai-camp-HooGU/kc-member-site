// ============================================================
// メール受信同期（運営のみ・手動トリガー）
//   POST /api/mail/sync → { results: SyncResult[] }
//
//   env / アプリ内(DB) の両方のアカウントを IMAP で同期し、mail_messages を更新する。
//   対象アカウントの解決（env資格情報 or DB暗号化資格情報）は syncAllMail 側で行う。
//   IMAP 接続はサーバー専用。requireOps 必須。
//   ⚠️ imapflow は net/tls を使うため Node ランタイムで動かす。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse } from "../../../../lib/authz";
import { syncAllMail } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    // env・DB どちらのアカウントも対象に同期する（未登録なら空配列が返るだけ）。
    const results = await syncAllMail();
    return NextResponse.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
