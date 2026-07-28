// ============================================================
// メールの移動（運営のみ）
//   POST /api/mail/move { id, targetFolder } → { ok }
//   IMAP へ MOVE し、DB の folder/uid も更新する。
//   ⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { moveMessage } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const { id, targetFolder } = (await request.json()) as { id?: number; targetFolder?: string };
    if (id == null || !targetFolder) throw new HttpError(400, "id と targetFolder は必須です");
    await moveMessage(id, targetFolder);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
