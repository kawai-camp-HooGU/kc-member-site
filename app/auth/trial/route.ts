// ============================================================
// 体験版：パスワードレスの即時ログイン
//
//   フォーム送信 → 外部ロールで会員登録 → ここに来て「その場でセッションを張る」。
//   ユーザーはメールを開く必要も、パスワードを決める必要もない。
//
//   /auth/trial?token_hash=xxxx&next=/
//
//   ⚠️ token_hash は formsServer の generateLink() で発行したワンタイムトークン。
//      メールのマジックリンクに載るものと同じ性質で、一度使うと無効になる。
//   ⚠️ Cookie を書くのは Route Handler の責務。createSupabaseServer() 経由で
//      verifyOtp すると、@supabase/ssr がセッション Cookie を書き込んでくれる。
//
//   参照: docs/属性自動更新_実装案.md ／ 体験版パスワードレス設計
// ============================================================
import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";
import { safeNext, MEMBER_ROOT } from "../../../lib/zone";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const next = safeNext(searchParams.get("next"), MEMBER_ROOT);

  // トークンが無い／不正 → ログイン画面へ（体験の入口を塞がないよう理由は付けない）
  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (error) {
    // 期限切れ・使用済みなど。パスワードレスなので /login でリンクを送り直せる。
    console.warn("体験セッションの確立に失敗:", error.message);
    return NextResponse.redirect(new URL("/login?trial=expired", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
