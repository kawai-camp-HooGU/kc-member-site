// ============================================================
// メール下書きの保存（運営のみ）
//   POST /api/mail/draft { accountId, to?, subject?, text, replyToId?, attachments?, replaceMessageId? } → { ok }
//   IMAP の Drafts フォルダへ \Draft フラグ付きで APPEND する。宛先は空でも可。
//   ⚠️ imapflow/nodemailer は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { saveDraftToAccount, type MailAttachment } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as {
      accountId?: number; to?: string; subject?: string; text?: string;
      replyToId?: number; attachments?: MailAttachment[]; replaceMessageId?: number;
    };
    if (b.accountId == null) throw new HttpError(400, "accountId は必須です");
    await saveDraftToAccount({
      accountId: b.accountId,
      to: b.to ?? "",
      subject: b.subject ?? "",
      text: b.text ?? "",
      replyToId: b.replyToId,
      attachments: b.attachments,
      replaceMessageId: b.replaceMessageId,
      sentBy: me.memberId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
