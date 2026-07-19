// ============================================================
// メールリンクの着地点（token_hash 方式）
//   /auth/confirm?token_hash=...&type=recovery&next=/set-password
//
//   【なぜ /auth/callback とは別に用意するのか】
//   /auth/callback は PKCE（?code=）用で、exchangeCodeForSession() が
//   「認証を開始したブラウザに保存された code_verifier」を要求する。
//
//   そのため、管理者が代理で送るメール（外部→メンバーの昇格時の
//   パスワード設定メール、メンバー招待）は PKCE では成立しない。
//     ・resetPasswordForEmail() を呼ぶのは管理者のブラウザ
//     ・リンクを開くのは会員のブラウザ（code_verifier が無い）
//     → exchangeCodeForSession() が失敗し、
//       「リンクの有効期限が切れています」と表示されてしまう
//       （実際には期限ではなく検証データの欠落）
//
//   token_hash + verifyOtp() は code_verifier を使わないため、
//   どのブラウザ・どの端末で開いても成立する。
//   別端末で開かれる可能性のあるメールリンクはすべてこちらに寄せる。
//
//   ⚠️ Supabase のメールテンプレートを次の形に変更すること。
//      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/set-password
//      （docs/Supabase認証メール原稿_KAWAI_CAMP.md 参照）
//
//   ⚠️ Route Handler（サーバー側）でセッション Cookie を張ってから
//      リダイレクトする。クライアントに token_hash を渡さないため、
//      URL がブラウザ履歴や Referer に残りにくい。
// ============================================================
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "../../../lib/supabaseServer";
import { safeNext, MEMBER_ROOT } from "../../../lib/zone";

/** 受け付ける OTP 種別（想定外の値を verifyOtp に渡さない） */
const ALLOWED_TYPES: readonly string[] = [
  "recovery",   // パスワード再設定（昇格時のパスワード設定メール）
  "invite",     // メンバー招待
  "signup",     // サインアップ確認
  "magiclink",  // パスワードなしログイン
  "email_change",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // オープンリダイレクト対策は safeNext に集約（自サイト内のパスのみ許可）
  const next = safeNext(url.searchParams.get("next"), MEMBER_ROOT);

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/auth/callback?auth_error=${reason}`, request.url));

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return fail("invalid");
  }

  const supabase = createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  // ここで失敗するのは「期限切れ」「使用済み」のいずれか。
  //   ⚠️ メールのスキャナがリンクを先読みしてトークンを消費する事例がある。
  //      その場合もここに来るため、再送を促す文言にしておく。
  if (error) return fail("expired");

  return NextResponse.redirect(new URL(next, request.url));
}
