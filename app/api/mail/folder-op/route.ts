// ============================================================
// フォルダ操作（運営のみ）：作成 / 改名 / 削除
//   POST /api/mail/folder-op
//     { accountId, action: "create", path }
//     { accountId, action: "rename", path, newPath }
//     { accountId, action: "delete", path }
//   IMAP 側にも反映する。⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { createFolder, renameFolder, deleteFolder } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface Body { accountId?: number; action?: "create" | "rename" | "delete"; path?: string; newPath?: string; }

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const b = (await request.json()) as Body;
    if (b.accountId == null || !b.path) throw new HttpError(400, "accountId と path は必須です");

    if (b.action === "rename") {
      if (!b.newPath) throw new HttpError(400, "newPath は必須です");
      await renameFolder(b.accountId, b.path, b.newPath);
    } else if (b.action === "delete") {
      await deleteFolder(b.accountId, b.path);
    } else {
      await createFolder(b.accountId, b.path);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
