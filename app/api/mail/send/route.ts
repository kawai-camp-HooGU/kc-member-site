// ============================================================
// メール送信（運営のみ）
//   POST /api/mail/send { accountId, to, subject, text, replyToId? } → { ok }
//   アカウントの SMTP で送信し、Sent フォルダにも残す（会話へ即反映）。
//   ⚠️ nodemailer/imapflow は Node ランタイム専用。
//   ⚠️ 送信ドメインの SPF/DKIM/DMARC 整備が前提（迷惑メール判定回避）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../lib/authz";
import { assertMailAccountAccess } from "../../../../lib/mailAuthz";
import { sendMailFromAccount, type MailAttachment } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const me = await requireOps(request);
    const b = (await request.json()) as { accountId?: number; to?: string; cc?: string; bcc?: string; subject?: string; text?: string; replyToId?: number; attachments?: MailAttachment[] };
    if (b.accountId == null) throw new HttpError(400, "accountId は必須です");
    if (!b.text || !b.text.trim()) throw new HttpError(400, "本文が空です");
    await assertMailAccountAccess(me, b.accountId, "operate");
    await sendMailFromAccount({
      accountId: b.accountId,
      to: b.to ?? "",
      cc: b.cc,
      bcc: b.bcc,
      subject: b.subject ?? "",
      text: b.text,
      replyToId: b.replyToId,
      attachments: b.attachments,
      sentBy: me.memberId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
