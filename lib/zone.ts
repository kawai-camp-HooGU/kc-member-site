// ============================================================
// ゾーン判定（Phase 2：入り口分離）
//
//   KAWAI CAMP は「運営（OPS）」と「会員（MEMBER）」で入り口を分ける。
//
//     OPS    … /ops/*        （将来: ops.kawaicamp-portal.com）
//     MEMBER … /（既存）      （将来: my.kawaicamp-portal.com）
//     PUBLIC … /f/[slug] など（認証不要）
//
//   ⚠️ 判定ロジックをこの1ファイルに集約しておくこと。
//      「案A：パス分離」→「案B：サブドメイン分離」への移行時、
//      resolveZone() の中を数行変えるだけで済むようにするため。
//
//   ⚠️ 入り口を分けただけではセキュリティは上がらない。
//      本丸は RLS（Phase 1 で実施済み）と middleware のゾーンガード。
//      URL の秘匿は「発見可能性の低減」でしかない。
// ============================================================
import type { MemberRole } from "./database.types";

export type Zone = "ops" | "member" | "public";

/** 運営ロール（このロールだけが OPS ゾーンに入れる） */
export const OPS_ROLES: readonly MemberRole[] = ["管理者", "オペレーター"];

/** 運営ロールか？（middleware / クライアント共通） */
export function isOpsRole(role: string | null | undefined): boolean {
  return role != null && (OPS_ROLES as readonly string[]).includes(role);
}

/**
 * 運営ゾーン（/ops）でしか表示しないビュー。
 *   app.tsx の view キー・SidebarContent の NavItem.key と対応する。
 *
 *   ⚠️ これは「見た目の出し分け」であって、セキュリティ境界ではない。
 *      サーバー側の境界は middleware（ゾーンガード）と RLS。
 */
export const OPS_VIEWS: readonly string[] = [
  "broadcast",   // 一斉配信
  "scenario",    // シナリオ配信
  "form",        // フォーム
  "master",      // 設定（マスタ管理）
  "contentset",  // コンテンツ設定
  "bulkadd",     // 一括登録
];

export const isOpsView = (view: string): boolean => OPS_VIEWS.includes(view);

// ── 各ゾーンの入り口 ──────────────────────────────────────────
export const OPS_ROOT      = "/ops";
export const OPS_LOGIN     = "/ops/login";
export const MEMBER_ROOT   = "/";
export const MEMBER_LOGIN  = "/login";

/** 認証不要で通すパス（プレフィックス一致 / 完全一致） */
//   ⚠️ /c/[token] は「認証不要で通す」だけ。実際に見せてよいかは
//      lib/contentsServer.ts が判定する（外部公開OFFなら会員判定＋属性判定を行う）。
// ⚠️ /s/[key] は流入経路の計測リダイレクタ。未ログインでも踏まれる（LP・広告・QR）ため公開。
//    ログイン中なら経路を記録してアクションを発火し、誘導先へ転送するだけ。
const PUBLIC_PREFIXES = ["/f/", "/c/", "/s/"];  // 公開フォーム／コンテンツ公開URL／流入経路リダイレクタ
// ⚠️ /auth/trial は「未ログインの状態で踏んでセッションを張る」入口。
//    ここを公開にしないと middleware が /login へ弾いてしまい、体験版が始まらない。
//   ⚠️ /auth/callback はマジックリンクの着地点。ここで Cookie にセッションを書くので、
//      認証不要ゾーンに置かないと「未ログイン扱い → /login へ 302」の無限ループになる。
const PUBLIC_EXACT    = ["/set-password", "/auth/trial", "/auth/callback"];  // 招待受諾・パスワード再設定・体験版の即時ログイン・マジックリンク着地

/**
 * リクエストのゾーンを判定する。
 *
 * @param url  リクエスト URL
 * @param host Host ヘッダ（案B のサブドメイン判定で使う。案A では未使用）
 */
export function resolveZone(url: URL, host: string): Zone {
  const path = url.pathname;

  // ── 公開（認証不要）──
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return "public";
  if (PUBLIC_EXACT.includes(path)) return "public";

  // ── 案B：サブドメインで判定（独自ドメイン取得後にここを有効化する）──
  //   ここを外すだけで「案A：パス分離」→「案B：サブドメイン分離」に昇格できる。
  //   if (host.startsWith("ops.")) return "ops";
  //   if (host.startsWith("my."))  return "member";
  void host;

  // ── 案A：パスで判定（現行）──
  if (path === OPS_ROOT || path.startsWith(`${OPS_ROOT}/`)) return "ops";
  return "member";
}

/** ゾーンごとのログイン画面 */
export function loginPathFor(zone: Zone): string {
  return zone === "ops" ? OPS_LOGIN : MEMBER_LOGIN;
}

/** ゾーンごとのトップ */
export function rootPathFor(zone: Zone): string {
  return zone === "ops" ? OPS_ROOT : MEMBER_ROOT;
}

/** ロールに応じた既定の着地先（ログイン成功後の遷移先） */
export function homePathForRole(role: string | null | undefined): string {
  return isOpsRole(role) ? OPS_ROOT : MEMBER_ROOT;
}

/**
 * オープンリダイレクト対策。
 * `?next=` に外部URLや `//evil.com` が入っていても弾き、自サイト内のパスだけ許可する。
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;   // 絶対URL・スキーム相対を拒否
  if (next.startsWith("//")) return fallback;   // //evil.com を拒否
  return next;
}
