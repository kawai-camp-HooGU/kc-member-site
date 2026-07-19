// ============================================================
// middleware — ゾーンガード（Phase 2：入り口分離）
//
//   サーバー側で必ず通る唯一の関所。ここで以下を行う。
//
//     ① セッションの自動更新（Phase 1 から継続。getUser() を呼ぶこと自体に意味がある）
//     ② 未ログイン           → ゾーン別のログイン画面へ 302（?next= で遷移先を保持）
//     ③ 会員が /ops/* を要求 → / へ 302（運営画面は「存在しないも同然」に）
//     ④ 運営が /（会員）を要求 → 通過（会員体験の確認用にあえて許可）
//     ⑤ /ops/* に noindex ヘッダ（検索エンジンから除外）
//     ⑥ OPS ゾーンの IP 許可リスト（OPS_ALLOWED_IPS。未設定なら制限しない＝段階導入）
//
//   ⚠️ 前提：Phase 1 の Cookie セッション化（@supabase/ssr）。
//      localStorage 保存のままではサーバーからセッションが見えず、このガードは書けない。
//
//   ⚠️ /api/* はこの middleware でロール判定しない（画面の関所であって API の関所ではない）。
//      API の認可は lib/authz.ts の requireOps() / requireMember() 等で個別に行う。
//      ここでは api/* をゾーン判定の対象外にし、セッション更新だけ通す。
//
//   ⚠️ 入り口分離「だけ」ではセキュリティは上がらない。本丸は RLS（Phase 1 で実施済み）。
//      URL の秘匿は Security by obscurity にすぎず、発見可能性を下げるだけ。
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddleware } from "./lib/supabaseServer";
import {
  resolveZone, isOpsRole, loginPathFor,
  OPS_ROOT, OPS_LOGIN, MEMBER_ROOT, MEMBER_LOGIN,
} from "./lib/zone";

/** そのゾーンのログイン画面自身か？（未ログインでも通す必要がある） */
const isLoginPath = (path: string) => path === OPS_LOGIN || path === MEMBER_LOGIN;

/** OPS ゾーンの IP 許可リスト（カンマ区切り。空なら制限しない） */
function ipAllowed(req: NextRequest): boolean {
  const allow = (process.env.OPS_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return allow.includes(ip);
}

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const res = NextResponse.next();

  const supabase = createSupabaseMiddleware(req, res);

  // ── 認証コードの取りこぼし防止（マジックリンクの安全網）──
  //
  //   マジックリンクは /auth/callback に着地させる設計だが、Supabase の
  //   「Redirect URLs」に /auth/callback が登録されていないと、Supabase は
  //   redirect_to を無視して Site URL（= "/"）に差し戻す。
  //   その場合 "/" に ?code=... が付いた状態で来るが、"/" は保護ゾーンなので
  //   セッションを張る前に /login へ 302 され、認証コードが捨てられて
  //   「ログイン → メール → リンク → ログイン」の無限ループになる。
  //
  //   そこで ?code= が付いていたら、どのパスに来ても /auth/callback へ渡す。
  //   （/auth/callback は公開ゾーン。そこでコードをセッションCookieに交換する）
  const authCode = url.searchParams.get("code");
  if (authCode && url.pathname !== "/auth/callback" && !url.pathname.startsWith("/api/")) {
    const to = new URL("/auth/callback", req.url);
    to.searchParams.set("code", authCode);
    to.searchParams.set("next", url.pathname === "/auth/callback" ? "/" : (url.pathname || "/"));
    return NextResponse.redirect(to);
  }

  // ── /api/* はセッション更新のみ（認可は各 Route の requireOps 等に任せる）──
  if (url.pathname.startsWith("/api/")) {
    await supabase.auth.getUser();
    return res;
  }

  const zone = resolveZone(url, req.headers.get("host") ?? "");

  // ── 公開ゾーン（/f/[slug]・/set-password）は素通し（セッション更新のみ）──
  if (zone === "public") {
    await supabase.auth.getUser();
    return res;
  }

  // ── OPS ゾーンの IP 制限（ログイン画面も含めて先に弾く）──
  if (zone === "ops" && !ipAllowed(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // ── Cookie セッションからログインユーザーを取得（同時にトークンを更新）──
  const { data: { user } } = await supabase.auth.getUser();

  // ── 未ログイン ──
  if (!user) {
    if (isLoginPath(url.pathname)) return res;   // ログイン画面自身は通す
    const to = new URL(loginPathFor(zone), req.url);
    // ログイン後に元のページへ戻せるよう遷移先を保持（オープンリダイレクトは safeNext で防止）
    to.searchParams.set("next", url.pathname + url.search);
    return NextResponse.redirect(to);
  }

  // ── ロール判定 ──
  //   RLS ヘルパー current_member_role() は security definer。
  //   members を直接 select するより確実（本人行の RLS や members_visible の都合に左右されない）。
  //   ⚠️ ロールマスタで追加した派生ロール（オペレーター派生）も運営として通す必要がある。
  //      役名の静的リスト（isOpsRole）では派生を判定できないため、
  //      DB 側の is_ops() を呼ぶ。この関数は roles.base_role を見るので
  //      ロールを追加しても middleware を書き換える必要がない。
  //      isOpsRole は is_ops() が呼べなかった場合のフォールバックとして残す。
  const [{ data: role }, { data: opsRpc, error: opsErr }] = await Promise.all([
    supabase.rpc("current_member_role"),
    supabase.rpc("is_ops"),
  ]);
  const ops = opsErr ? isOpsRole(role) : opsRpc === true;

  // ── ログイン済みでログイン画面に来たら、ロールに応じたトップへ ──
  if (isLoginPath(url.pathname)) {
    return NextResponse.redirect(new URL(ops ? OPS_ROOT : MEMBER_ROOT, req.url));
  }

  // ── ★本命：会員が運営ゾーンを叩いたら追い出す ──
  if (zone === "ops" && !ops) {
    return NextResponse.redirect(new URL(MEMBER_ROOT, req.url));
  }

  // ── 運営ゾーンは検索避け ──
  if (zone === "ops") {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

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
     *   api/broadcast/click, api/scenario/click, api/chat/click … 本文内リンクの計測（未ログインで踏む）
     */
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|api/cron|api/form/submit|api/broadcast/click|api/scenario/click|api/chat/click).*)",
  ],
};
