// ============================================================
// LIFF会員連携フォームの回答受付（POST・公開）
//   LIFFで取得した userId ＋ 氏名/メール/電話 を保存し、会員照合まで実行。
// ============================================================
import { NextResponse } from "next/server";
import { saveLiffCollectedAndMatch } from "../../../../lib/lineLiffServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body { accountId?: number; userId?: string; name?: string; kana?: string; email?: string; phone?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const b = (await request.json()) as Body;
    if (b.accountId == null) return NextResponse.json({ error: "accountId は必須です" }, { status: 400 });
    if (!b.userId) return NextResponse.json({ error: "ユーザー情報を取得できませんでした" }, { status: 400 });
    if (!b.email?.trim() && !b.phone?.trim()) {
      return NextResponse.json({ error: "メールアドレスまたは電話番号を入力してください" }, { status: 400 });
    }
    const r = await saveLiffCollectedAndMatch(b.accountId, b.userId, b);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "送信に失敗しました" }, { status: 400 });
    return NextResponse.json({ ok: true, linked: r.linked ?? false });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
