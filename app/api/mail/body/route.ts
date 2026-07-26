// ============================================================
// メール本文の取得（運営のみ・オンデマンド）
//   POST /api/mail/body { id } → { bodyText, bodyHtml, hasAttach }
//
//   ハイブリッド型：本文はDBに保存せず、開いた瞬間に IMAP から都度取得する。
//   IMAP 接続・資格情報の復号はサーバー専用。requireOps 必須。
//   ⚠️ imapflow/mailparser は net/tls を使うため Node ランタイムで動かす。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { fetchMessageBody } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const { id } = (await request.json()) as { id?: number };
    if (id == null) throw new HttpError(400, "id は必須です");
    const body = await fetchMessageBody(id);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
