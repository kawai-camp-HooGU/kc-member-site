// ============================================================
// LINE連携 登録フォームの回答受付（POST・公開）
//   認可＝トークン（friend の link_token）。ログイン不要。
//   本人が入力した 氏名・メール・電話 を保存し、会員照合まで実行する。
// ============================================================
import { NextResponse } from "next/server";
import { saveCollectedAndMatch } from "../../../../lib/lineLinkServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body { token?: string; name?: string; kana?: string; email?: string; phone?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const b = (await request.json()) as Body;
    const token = (b.token ?? "").trim();
    if (!token) return NextResponse.json({ error: "リンクが無効です" }, { status: 400 });
    if (!b.email?.trim() && !b.phone?.trim()) {
      return NextResponse.json({ error: "メールアドレスまたは電話番号を入力してください" }, { status: 400 });
    }
    const r = await saveCollectedAndMatch(token, b);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "送信に失敗しました" }, { status: 400 });
    return NextResponse.json({ ok: true, linked: r.linked ?? false });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
