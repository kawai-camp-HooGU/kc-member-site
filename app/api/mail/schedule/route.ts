// ============================================================
// メール送信予約の管理（運営のみ・サーバー専用）
//   POST /api/mail/schedule
//     { action: "create", ...input } → { id }
//     { action: "list" }             → { scheduled }
//     { action: "cancel", id }       → { ok }
//   ⚠️ imapflow/nodemailer は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../lib/authz";
import { assertMailAccountAccess, assertScheduledMailAccess, filterAccessibleAccountIds } from "../../../../lib/mailAuthz";
import { createScheduledMail, listScheduledMail, cancelScheduledMail } from "../../../../lib/mailServer";
import type { MailAttachment } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Body {
  action?: "create" | "list" | "cancel";
  id?: number;
  accountId?: number; to?: string; cc?: string; bcc?: string; subject?: string; text?: string;
  replyToId?: number; attachments?: MailAttachment[]; scheduledAt?: string;
}

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as Body;
    if (b.action === "cancel") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      requireSameOrigin(request);
      await assertScheduledMailAccess(me, b.id, "operate");
      await cancelScheduledMail(b.id);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "create") {
      if (b.accountId == null) throw new HttpError(400, "accountId は必須です");
      if (!b.scheduledAt) throw new HttpError(400, "予約日時は必須です");
      requireSameOrigin(request);
      await assertMailAccountAccess(me, b.accountId, "operate");
      const { id } = await createScheduledMail({
        accountId: b.accountId, to: b.to ?? "", cc: b.cc, bcc: b.bcc, subject: b.subject ?? "",
        text: b.text ?? "", replyToId: b.replyToId, attachments: b.attachments,
        scheduledAt: b.scheduledAt, createdBy: me.memberId,
      });
      return NextResponse.json({ id });
    }
    // 既定は list（閲覧できるアカウントの予約だけに絞る）
    const all = await listScheduledMail();
    const okIds = await filterAccessibleAccountIds(me, all.map((s) => s.accountId));
    const scheduled = me.isAdmin ? all : all.filter((s) => okIds.has(s.accountId));
    return NextResponse.json({ scheduled });
  } catch (err) {
    return errorResponse(err);
  }
}
