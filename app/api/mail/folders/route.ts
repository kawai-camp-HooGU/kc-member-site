// ============================================================
// メールのフォルダ一覧（運営のみ）
//   GET /api/mail/folders?accountId=1 → { folders: FolderInfo[] }
//
//   IMAP からフォルダ構成を取得し、DB上の未読/総数を添えて返す。
//   IMAP 接続はサーバー専用。requireOps 必須。
//   ⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { listAccountFolders } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    await requireOps(request);
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get("accountId"));
    if (!accountId) throw new HttpError(400, "accountId は必須です");
    const folders = await listAccountFolders(accountId);
    return NextResponse.json({ folders });
  } catch (err) {
    return errorResponse(err);
  }
}
