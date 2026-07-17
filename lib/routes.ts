// ============================================================
// URL ⇄ 画面（view / 詳細ID）の相互変換
//
//   固定URL化の中心。URLを「唯一の状態源」として扱い、
//   app.tsx や各ビューの useState（view / detailId / editId …）を置き換える。
//
//   規則（docs/URL設計_固定URL化.md）
//     ・ゾーンはパスの先頭      … 会員 "/" ／ 運営 "/ops"
//     ・画面はパス、モーダルはクエリ
//     ・IDは数値（DBの主キー）。未ログインで開くURLだけトークン（/c/{token}・/f/{slug}）
//
//   ⚠️ ここに無い静的ルート（/login・/set-password・/f/…・/c/…・
//      /ops/login・/ops/members/[id]・/ops/submissions/[id]）はキャッチオールより
//      優先されるため、この変換の対象外。
// ============================================================
import type { Zone } from "./zone";

export const MEMBER_DEFAULT_VIEW = "home";
// ログイン直後の着地は全ユーザー「ホーム画面」。運営ゾーンのトップ "/ops" も home に着地させる。
//   （ダッシュボードは "/ops/dashboard" で従来どおりアクセス可能）
export const OPS_DEFAULT_VIEW    = "home";

export interface ParsedRoute {
  zone: Zone;
  view: string;
  /** view より後ろのパスセグメント（例: ["3","submissions"]） */
  detail: string[];
}

/** パス文字列 → { zone, view, detail } */
export function parsePath(pathname: string): ParsedRoute {
  const seg = (pathname || "/").split("/").filter(Boolean);

  if (seg[0] === "ops") {
    const rest = seg.slice(1);
    if (rest.length === 0) return { zone: "ops", view: OPS_DEFAULT_VIEW, detail: [] };
    return { zone: "ops", view: rest[0], detail: rest.slice(1) };
  }
  if (seg.length === 0) return { zone: "member", view: MEMBER_DEFAULT_VIEW, detail: [] };
  return { zone: "member", view: seg[0], detail: seg.slice(1) };
}

/** { zone, view, detail } → パス文字列 */
export function buildPath(zone: Zone, view: string, detail: (string | number)[] = []): string {
  const tail = detail.filter((d) => d !== "" && d != null).map(String);

  if (zone === "ops") {
    if (view === OPS_DEFAULT_VIEW && tail.length === 0) return "/ops";
    return `/ops/${[view, ...tail].join("/")}`;
  }
  if (view === MEMBER_DEFAULT_VIEW && tail.length === 0) return "/";
  return `/${[view, ...tail].join("/")}`;
}

/** クエリを付与（null / undefined / "" のキーは落とす） */
export function withQuery(path: string, query?: Record<string, string | number | null | undefined>): string {
  if (!query) return path;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** クエリ文字列 → 数値ID（不正値は null） */
export function numParam(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
