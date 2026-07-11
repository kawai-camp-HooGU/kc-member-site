// ============================================================
// middleware（Phase 1：セッションの自動更新のみ）
//
//   Cookie セッション化に伴い、アクセストークンの更新を
//   サーバー側で行う必要がある。getUser() を呼ぶことで
//   期限切れ間近のトークンが更新され、Cookie に書き戻される。
//   これが無いと、しばらく放置したユーザーが突然ログアウトされる。
//
//   ⚠️ Phase 2 では、ここに「ゾーンガード」を追加する：
//      ・/ops/* に会員がアクセスしたら追い出す
//      ・運営ゾーンに noindex ヘッダを付ける
//      ・運営ゾーンのみ IP 制限 / MFA
//      土台（lib/supabaseServer.ts の createSupabaseMiddleware）は用意済み。
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddleware } from "./lib/supabaseServer";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // セッションの更新（結果は使わないが、呼ぶこと自体に意味がある）
  const supabase = createSupabaseMiddleware(req, res);
  await supabase.auth.getUser();

  return res;
}

export const config = {
  matcher: [
    /*
     * 以下を除く全てのパスにマッチさせる：
     *   _next/static      … 静的ファイル
     *   _next/image       … 画像最適化
     *   favicon / icon    … アイコン類
     *   api/cron          … Vercel Cron（CRON_SECRET で別途検証）
     *   api/form/submit   … 公開フォームの送信（未ログインで叩く）
     *   api/broadcast/click, api/scenario/click … メール内リンクの計測
     */
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|api/cron|api/form/submit|api/broadcast/click|api/scenario/click).*)",
  ],
};
