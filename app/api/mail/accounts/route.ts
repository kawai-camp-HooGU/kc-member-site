// ============================================================
// メールアカウントの管理（運営のみ・サーバー専用）
//   POST /api/mail/accounts
//     { action: "save",   ...MailAccountSaveInput } → { id }
//     { action: "test",   ...MailAccountSaveInput } → { ok, error? }
//     { action: "delete", id }                      → { ok }
//
//   IMAP パスワードの暗号化・保存・接続はサーバーでのみ行う。
//   一覧・既読/スター/フラグはクライアントが RLS(運営) で直接読む（lib/mail.ts）。
//   ⚠️ imapflow/crypto は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { isSecretKeyConfigured } from "../../../../lib/mailCrypto";
import { saveMailAccount, deleteMailAccount, testMailAccount } from "../../../../lib/mailServer";
import type { MailAccountSaveInput } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends MailAccountSaveInput {
  action?: "save" | "test" | "delete";
}

export async function POST(request: Request) {
  try {
    await requireOps(request);
    if (!isSecretKeyConfigured()) {
      throw new HttpError(400, "MAIL_SECRET_KEY が未設定です（openssl rand -base64 32 で生成し環境変数に設定してください）");
    }
    const b = (await request.json()) as Body;

    if (b.action === "test") {
      const r = await testMailAccount(b);
      return NextResponse.json(r);
    }
    if (b.action === "delete") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      await deleteMailAccount(b.id);
      return NextResponse.json({ ok: true });
    }
    // 既定は save
    const { id } = await saveMailAccount(b);
    return NextResponse.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
