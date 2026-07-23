// ============================================================
// 利用状況（最終ログイン／コンテンツ視聴ログ）のデータ層＋集計ヘルパー
//   - ログイン記録は members.last_login_at 等（RPC: touch_login）
//   - 視聴ログは content_views（RPC: record_content_view）
// ============================================================
import { supabase } from "./supabase";
import { canView } from "./contents";
import { fmtJst } from "./dateFmt";
import type { Member, ContentPage, CmsContent } from "./models";
import type { AttrIndex } from "./members";

export interface ContentViewRow {
  memberId: number;
  contentId: number;
  firstViewedAt: string;
  lastViewedAt: string;
  viewCount: number;
}

// ── 記録 ──────────────────────────────────────────────────────
/** ログイン時に1回だけ呼ぶ（本人の行のみ更新）。失敗してもアプリは止めない。 */
export async function touchLogin(): Promise<void> {
  const { error } = await supabase.rpc("touch_login");
  if (error) console.warn("touch_login 失敗（マイグレーション未適用の可能性）:", error);
}

/** コンテンツ詳細を開いたときに呼ぶ（初回=登録／2回目以降=最終視聴日時と回数を更新）。 */
export async function recordContentView(contentId: number): Promise<void> {
  const { error } = await supabase.rpc("record_content_view", { p_content_id: contentId });
  if (error) console.warn("record_content_view 失敗（マイグレーション未適用の可能性）:", error);
}

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchContentViews(): Promise<ContentViewRow[]> {
  const { data, error } = await supabase.from("content_views").select("*");
  if (error) { console.warn("content_views 取得エラー（マイグレーション未適用の可能性）:", error); return []; }
  return (data ?? []).map((r) => ({
    memberId: r.member_id, contentId: r.content_id,
    firstViewedAt: r.first_viewed_at ?? "", lastViewedAt: r.last_viewed_at ?? "",
    viewCount: r.view_count ?? 0,
  }));
}

// ── 視聴ログのインデックス ───────────────────────────────────
export interface ViewIndex {
  byMember: Map<number, Map<number, ContentViewRow>>;  // memberId → contentId → row
  byContent: Map<number, ContentViewRow[]>;            // contentId → rows
}
export function buildViewIndex(rows: ContentViewRow[]): ViewIndex {
  const byMember = new Map<number, Map<number, ContentViewRow>>();
  const byContent = new Map<number, ContentViewRow[]>();
  rows.forEach((r) => {
    const mm = byMember.get(r.memberId) ?? new Map<number, ContentViewRow>();
    mm.set(r.contentId, r);
    byMember.set(r.memberId, mm);
    const cc = byContent.get(r.contentId) ?? [];
    cc.push(r);
    byContent.set(r.contentId, cc);
  });
  return { byMember, byContent };
}
export const EMPTY_VIEW_INDEX: ViewIndex = { byMember: new Map(), byContent: new Map() };

// ── ログイン状態 ─────────────────────────────────────────────
export type LoginState = "never" | "active" | "idle" | "dormant";
export const LOGIN_STATE_LABEL: Record<LoginState, string> = {
  never: "未ログイン", active: "アクティブ", idle: "7日以上未ログイン", dormant: "30日以上未ログイン",
};
/** 最終ログインからの経過日数（未ログインは null） */
export function daysSinceLogin(m: Member): number | null {
  const t = m.lastLoginAt ? Date.parse(m.lastLoginAt) : NaN;
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
export function loginState(m: Member): LoginState {
  const d = daysSinceLogin(m);
  if (d === null) return "never";
  if (d >= 30) return "dormant";
  if (d >= 7) return "idle";
  return "active";
}
/** 「3日前」「今日」「—」等の相対表示 */
export function relDays(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "今日";
  if (d === 1) return "昨日";
  if (d < 30) return `${d}日前`;
  if (d < 365) return `${Math.floor(d / 30)}か月前`;
  return `${Math.floor(d / 365)}年前`;
}
// 日時表示はJST固定（UTCのtimestamptzを9時間ずらさない）。共通実装は lib/dateFmt。
export const fmtDateTime = (iso: string | undefined): string => fmtJst(iso);

// ── コンテンツの可視判定・進捗集計 ───────────────────────────
/** メンバーが閲覧できる公開コンテンツ（ページ条件 AND コンテンツ条件） */
export function visibleContentsFor(
  m: Member, pages: ContentPage[], contents: CmsContent[], index: AttrIndex,
): CmsContent[] {
  const attrs = m.attrIds ?? [];
  const okPages = new Set(
    pages.filter((p) => canView(p.attrIds, p.attrMode, attrs, index)).map((p) => p.id),
  );
  return contents.filter((c) => c.published && okPages.has(c.pageId) && canView(c.attrIds, c.attrMode, attrs, index));
}

export interface Progress { total: number; viewed: number; pct: number; }
export const EMPTY_PROGRESS: Progress = { total: 0, viewed: 0, pct: 0 };

/** メンバーのコンテンツ視聴進捗（分母＝そのメンバーが閲覧できる公開コンテンツ数） */
export function memberProgress(
  m: Member, pages: ContentPage[], contents: CmsContent[], index: AttrIndex, views: ViewIndex,
): Progress {
  const list = visibleContentsFor(m, pages, contents, index);
  const seen = views.byMember.get(m.id);
  const viewed = seen ? list.filter((c) => seen.has(c.id)).length : 0;
  const total = list.length;
  return { total, viewed, pct: total === 0 ? 0 : Math.round((viewed / total) * 100) };
}

export type ProgressState = "none" | "partial" | "done";
export function progressState(p: Progress): ProgressState {
  if (p.total === 0 || p.viewed === 0) return "none";
  return p.viewed >= p.total ? "done" : "partial";
}

/** メンバー全員分の進捗を一括算出（一覧・並び替え用） */
export function buildProgressMap(
  members: Member[], pages: ContentPage[], contents: CmsContent[], index: AttrIndex, views: ViewIndex,
): Map<number, Progress> {
  const map = new Map<number, Progress>();
  members.forEach((m) => map.set(m.id, memberProgress(m, pages, contents, index, views)));
  return map;
}

// ── コンテンツ側の横断集計 ───────────────────────────────────
export interface ContentStat {
  content: CmsContent;
  page: ContentPage | undefined;
  targets: Member[];      // 公開対象のメンバー
  viewers: Member[];      // うち視聴済み
  unviewed: Member[];     // うち未視聴
  pct: number;            // 視聴率
  totalViews: number;     // 延べ視聴回数
  lastViewedAt: string;   // 直近の視聴日時
}

/** 指定コンテンツの対象者・視聴者を集計。audience は集計対象にするメンバー配列（スタッフ除外などは呼び出し側で）。 */
export function contentStat(
  c: CmsContent, pages: ContentPage[], audience: Member[], index: AttrIndex, views: ViewIndex,
): ContentStat {
  const page = pages.find((p) => p.id === c.pageId);
  const targets = audience.filter((m) => {
    const attrs = m.attrIds ?? [];
    const pageOk = !page || canView(page.attrIds, page.attrMode, attrs, index);
    return pageOk && canView(c.attrIds, c.attrMode, attrs, index);
  });
  const rows = views.byContent.get(c.id) ?? [];
  const rowByMember = new Map(rows.map((r) => [r.memberId, r]));
  const viewers  = targets.filter((m) => rowByMember.has(m.id));
  const unviewed = targets.filter((m) => !rowByMember.has(m.id));
  const totalViews = rows.reduce((s, r) => s + r.viewCount, 0);
  const lastViewedAt = rows.reduce((s, r) => (r.lastViewedAt > s ? r.lastViewedAt : s), "");
  return {
    content: c, page, targets, viewers, unviewed,
    pct: targets.length === 0 ? 0 : Math.round((viewers.length / targets.length) * 100),
    totalViews, lastViewedAt,
  };
}
