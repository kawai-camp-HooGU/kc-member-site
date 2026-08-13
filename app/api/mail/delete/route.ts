// ============================================================
// メールの削除（運営のみ）
//   POST /api/mail/delete { id } → { ok }
//   IMAP から \Deleted + expunge し、DB行も削除する。
//   下書きの後始末（送信後の自動保存下書きの削除）などに使う。
//   ⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../lib/authz";
import { assertMailMessageAccess } from "../../../../lib/mailAuthz";
import { deleteMessage } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const me = await requireOps(request);
    const { id } = (await request.json()) as { id?: number };
    if (id == null) throw new HttpError(400, "id は必須です");
    await assertMailMessageAccess(me, id, "operate");
    await deleteMessage(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
