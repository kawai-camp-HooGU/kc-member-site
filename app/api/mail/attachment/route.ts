// ============================================================
// メール添付の取得（運営のみ・オンデマンド）
//   POST /api/mail/attachment { id }          → 添付の一覧（メタのみ）
//   POST /api/mail/attachment { id, index }   → その添付の実体（base64付き）
//   本文はDBに保存しない方針に合わせ、添付も都度 IMAP から取得する。
//   ⚠️ imapflow/mailparser は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { assertMailMessageAccess } from "../../../../lib/mailAuthz";
import { fetchMessageAttachments } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const { id, index } = (await request.json()) as { id?: number; index?: number };
    if (id == null) throw new HttpError(400, "id は必須です");
    await assertMailMessageAccess(me, id, "see");
    const result = await fetchMessageAttachments(id, index);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
