// ============================================================
// メール定型文テンプレートの管理（運営のみ・サーバー専用）
//   POST /api/mail/templates
//     { action: "list" }              → { templates }
//     { action: "save", ...input }    → { id }
//     { action: "delete", id }        → { ok }
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../lib/authz";
import { listMailTemplates, saveMailTemplate, deleteMailTemplate } from "../../../../lib/mailServer";
import type { MailTemplateInput } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends Partial<MailTemplateInput> {
  action?: "list" | "save" | "delete";
}

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const b = (await request.json()) as Body;
    if (b.action === "delete") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      requireSameOrigin(request);
      await deleteMailTemplate(b.id);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "save") {
      requireSameOrigin(request);
      const { id } = await saveMailTemplate({ id: b.id, name: b.name ?? "", subject: b.subject, body: b.body ?? "", sortOrder: b.sortOrder });
      return NextResponse.json({ id });
    }
    // 既定は list
    const templates = await listMailTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    return errorResponse(err);
  }
}
