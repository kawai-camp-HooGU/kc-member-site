// ============================================================
// メール受信同期（運営のみ・手動トリガー）
//   POST /api/mail/sync → { results: SyncResult[] }
//
//   env に設定された全アカウントを IMAP で同期し、mail_messages を更新する。
//   IMAP 接続・env資格情報の参照はサーバー専用。requireOps 必須。
//   ⚠️ imapflow は net/tls を使うため Node ランタイムで動かす。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { isMailConfigured, syncAllMail } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    if (!isMailConfigured()) {
      throw new HttpError(400, "メール連携が未設定です（環境変数 MAIL_ACCOUNTS を設定してください）");
    }
    const results = await syncAllMail();
    return NextResponse.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
