// ============================================================
// 会員ホームのブロック（REQ-094）のデータ層
//
//   ホームは「運営が組んだブロックの並び」で描く。ホームは2枚ある：
//     メンバー用（audience='member'）／外部用（audience='external'）
//   1ブロックは必ずどちらか一方に属する（"両方" は無い）。
//
//   ⚠️ ブロックを出すかどうかの判定は isBlockVisible() 1つに閉じる。
//      画面側に条件を散らかすと「どこで消えたのか分からない」状態になる。
//
//   ⚠️ fetchHomeBlocks() は失敗したら throw する（return [] にしない）。
//      握ってしまうと呼び出し側が原因を掴めなくなる。
//      → HomeView は「取得失敗」も「0件」も同じ扱いにして、
//        LegacyHomeView（改修前のホーム）へ丸ごと倒す。
// ============================================================
import { supabase } from "./supabase";
import { canView } from "./contents";
import { sanitizeDoorHtml } from "./ai/sanitizeDoor";
import type { Json, Tables } from "./database.types";
import type {
  HomeBlock, HomeAudience, HomeBlockKind, HomeBlockConfig, HomeSourceMode,
  PublishMode, PermissionRole, CmsContent, ContentPage,
} from "./models";
import type { AttrIndex } from "./members";
import type { ContentViewRow } from "./engagement";

// ── 値の正規化（未知の値・列なしは既定へ倒す）────────────────
const asAudience = (s: string | null | undefined): HomeAudience =>
  s === "external" ? "external" : "member";

const KINDS: readonly HomeBlockKind[] =
  ["hero", "continue", "shelf", "ranking", "launcher", "news", "event", "html"];
/** 未知の kind は null。描画側でスキップする（将来 kind を足しても古いJSで落ちない） */
const asKind = (s: string | null | undefined): HomeBlockKind | null =>
  KINDS.includes(s as HomeBlockKind) ? (s as HomeBlockKind) : null;

const SOURCES: readonly HomeSourceMode[] =
  ["none", "section", "page", "content", "manual", "auto"];
const asSource = (s: string | null | undefined): HomeSourceMode =>
  SOURCES.includes(s as HomeSourceMode) ? (s as HomeSourceMode) : "none";

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";

/** jsonb は any で来るので、使うキーだけ型を見て拾う */
function asConfig(v: unknown): HomeBlockConfig {
  if (v == null || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
  const bool = (x: unknown): boolean | undefined => (typeof x === "boolean" ? x : undefined);
  /** 0〜100 に収める（範囲外・非数値は未設定＝既定の50へ倒す） */
  const pct = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : undefined;
  return {
    limit:     num(o.limit),
    period:    o.period === "month" ? "month" : o.period === "week" ? "week" : undefined,
    lead:      str(o.lead),
    ctaLabel:  str(o.ctaLabel),
    imageUrl:  str(o.imageUrl),
    kicker:    str(o.kicker),
    focusX:    pct(o.focusX),
    focusY:    pct(o.focusY),
    showMore:  bool(o.showMore),
    rail:      bool(o.rail),
  };
}

// ── 取得 ────────────────────────────────────────────────
/**
 * ブロック定義をすべて取得する（メンバー用・外部用の両方）。
 * ⚠️ 失敗したら throw する。呼び出し側でフォールバックすること（冒頭の注記）。
 */
export async function fetchHomeBlocks(): Promise<HomeBlock[]> {
  const [{ data: rows, error: e1 }, { data: attrs, error: e2 }] = await Promise.all([
    supabase.from("home_blocks").select("*")
      .eq("is_deleted", false).order("audience").order("sort_order").order("id"),
    supabase.from("home_block_attributes").select("*"),
  ]);
  if (e1) throw e1;
  if (e2) console.warn("home_block_attributes 取得エラー:", e2);

  const attrMap = new Map<number, number[]>();
  (attrs ?? []).forEach((r) => {
    const a = attrMap.get(r.block_id) ?? [];
    a.push(r.attribute_id);
    attrMap.set(r.block_id, a);
  });

  const toBlock = (r: Tables<"home_blocks">): HomeBlock | null => {
    const kind = asKind(r.kind);
    if (kind == null) return null;                       // 未知の kind は捨てる
    return {
      id: r.id,
      audience: asAudience(r.audience),
      kind,
      title: r.title ?? "",
      sortOrder: r.sort_order ?? 0,
      published: r.published ?? true,
      displayFrom:  r.display_from  ?? "",
      displayUntil: r.display_until ?? "",
      attrMode: asMode(r.attr_mode),
      attrIds: attrMap.get(r.id) ?? [],
      sourceMode: asSource(r.source_mode),
      sourceSectionId: r.source_section_id ?? null,
      sourcePageId:    r.source_page_id    ?? null,
      sourceContentId: r.source_content_id ?? null,
      contentIds: r.content_ids ?? [],
      config: asConfig(r.config),
      bodyHtml: r.body_html ?? "",
    };
  };

  const list: HomeBlock[] = [];
  (rows ?? []).forEach((r) => {
    const b = toBlock(r);
    if (b) list.push(b);
  });
  return list;
}

// ── 表示判定（ここ1か所に閉じる）─────────────────────────
export interface VisibleCtx {
  /** 見る人のロール。運営がプレビュー中は見たい側のロールを渡す */
  role: HomeAudience;
  /** 管理者・オペレーターか（属性を無視して全部見える。現行 HomeView と同じ） */
  seeAll: boolean;
  myAttrs: number[];
  idx: AttrIndex;
  now: number;
}

/**
 * このブロックを出すか。
 *   ① 公開ON  ② 掲載期間内  ③ どちらのホームか  ④ 公開対象属性
 *   の順で見る。運営（seeAll）は ③④ を素通りする。
 */
export function isBlockVisible(b: HomeBlock, ctx: VisibleCtx): boolean {
  if (!b.published) return false;

  // ① 掲載期間
  if (b.displayFrom  && Date.parse(b.displayFrom)  >  ctx.now) return false;
  if (b.displayUntil && Date.parse(b.displayUntil) <= ctx.now) return false;

  // ② どちらのホームか（運営プレビューでも守る。見たい側を role に渡すため）
  if (b.audience !== ctx.role) return false;

  // ③ 運営は属性を無視して全部見える
  if (ctx.seeAll) return true;

  // ④ 公開対象属性（既存の canView をそのまま使う）
  return canView(b.attrIds, b.attrMode, ctx.myAttrs, ctx.idx);
}

/** ログインユーザーがどちらのホームを見るか。運営はメンバー用を既定にする。 */
export function homeAudienceFor(role: PermissionRole): HomeAudience {
  return role === "external" ? "external" : "member";
}

// ── 中身の絞り込み ──────────────────────────────────────
export interface HomePool {
  pages: ContentPage[];
  contents: CmsContent[];
  views: ContentViewRow[];
}

/** 期間の起点（月曜0時／月初0時） */
export function startOfWeek(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;          // 月曜=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
export function startOfMonth(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

/**
 * ブロックに並べるコンテンツを選ぶ。
 *
 * ⚠️ ページの published を条件に入れている。改修前の HomeView は見ていなかったため、
 *    非公開ページ配下のコンテンツが未視聴件数に入っていた（会員は開けないのに数だけ増える）。
 *    これは意図的な挙動変更（設計書 §11-14＝a）。
 */
export function pickForBlock(
  b: HomeBlock,
  pool: HomePool,
  myId: number | null,
  myAttrs: number[],
  idx: AttrIndex,
  seeAll: boolean,
): CmsContent[] {
  // ① 会員が見られるものだけに落とす（ページ・コンテンツの両方で判定）
  const okPages = new Set(
    pool.pages
      .filter((p) => p.published && (seeAll || canView(p.attrIds, p.attrMode, myAttrs, idx)))
      .map((p) => p.id),
  );
  const base = pool.contents.filter(
    (c) => c.published && okPages.has(c.pageId)
        && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, idx)),
  );

  // ② ソースで絞る
  let list = base;
  if (b.sourceMode === "section") {
    const pageIds = new Set(
      pool.pages.filter((p) => p.sectionId === b.sourceSectionId).map((p) => p.id),
    );
    list = base.filter((c) => pageIds.has(c.pageId));
  } else if (b.sourceMode === "page") {
    list = base.filter((c) => c.pageId === b.sourcePageId);
  } else if (b.sourceMode === "content") {
    list = base.filter((c) => c.id === b.sourceContentId);
  } else if (b.sourceMode === "manual") {
    const order = new Map(b.contentIds.map((id, i) => [id, i] as const));
    list = base
      .filter((c) => order.has(c.id))
      .sort((a, z) => (order.get(a.id) ?? 0) - (order.get(z.id) ?? 0));
  }

  // ③ auto（新着）と continue は createdAt 降順。
  //    fetchContentData() の既定順は sort_order → id なので、ここで並べ直す必要がある。
  if (b.sourceMode === "auto" || b.kind === "continue") {
    list = [...list].sort((a, z) => (z.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  // ④ continue は未視聴だけに絞る（視聴済／未視聴の2値。再生位置は持たない）
  if (b.kind === "continue" && myId != null) {
    const seen = seenIdsOf(pool.views, myId);
    list = list.filter((c) => !seen.has(c.id));
  }

  return list.slice(0, Math.max(1, b.config.limit ?? 8));
}

/** その会員が視聴済みのコンテンツID */
export function seenIdsOf(views: ContentViewRow[], myId: number | null): Set<number> {
  if (myId == null) return new Set<number>();
  return new Set(views.filter((v) => v.memberId === myId).map((v) => v.contentId));
}

export interface RankedContent { content: CmsContent; viewers: number; }

/**
 * 「今週よく見られているもの」。
 *   content_views は「会員×コンテンツ」で1行、last_viewed_at が最後に見た時刻。
 *   期間内に last_viewed_at がある行を数える＝その期間に見た人数。
 *   ⚠️ 同じ人が3回見ても1人。「視聴回数」ではなく「視聴した人数」なので、
 *      画面のラベルも「今週 24人が視聴」と書く。view_count は累計で期間集計に使えない。
 */
export function pickRanking(
  b: HomeBlock,
  pool: HomePool,
  myAttrs: number[],
  idx: AttrIndex,
  seeAll: boolean,
): RankedContent[] {
  const from = b.config.period === "month" ? startOfMonth() : startOfWeek();
  const count = new Map<number, number>();
  pool.views.forEach((v) => {
    if (Date.parse(v.lastViewedAt) >= from) {
      count.set(v.contentId, (count.get(v.contentId) ?? 0) + 1);
    }
  });

  // 会員が見られるものだけに絞ってから並べ替える（件数は後で切るので広めに取る）
  const wide: HomeBlock = { ...b, kind: "shelf", config: { ...b.config, limit: 9999 } };
  return pickForBlock(wide, pool, null, myAttrs, idx, seeAll)
    .map((c) => ({ content: c, viewers: count.get(c.id) ?? 0 }))
    .filter((r) => r.viewers > 0)                       // 0人のものは出さない
    .sort((a, z) => z.viewers - a.viewers || a.content.id - z.content.id)
    .slice(0, Math.max(1, b.config.limit ?? 5));
}

// ── 保存（運営）────────────────────────────────────────
export type SaveResult =
  | { id: number; error?: undefined }
  | { id: null; error: string };

async function replaceBlockAttrs(blockId: number, attrIds: number[]): Promise<void> {
  await supabase.from("home_block_attributes").delete().eq("block_id", blockId);
  if (attrIds.length) {
    await supabase.from("home_block_attributes")
      .insert(attrIds.map((id) => ({ block_id: blockId, attribute_id: id })));
  }
}

/** 空文字は NULL として送る（timestamptz に "" を入れると 22007 になる） */
const orNull = (s: string): string | null => (s.trim() === "" ? null : s);

export async function saveHomeBlock(b: HomeBlock): Promise<SaveResult> {
  // html ブロックは必ずサニタイズを通す（扉ページと同じ経路。二重に持たない）
  const body = b.kind === "html" ? sanitizeDoorHtml(b.bodyHtml).html : null;

  const row = {
    audience: b.audience,
    kind: b.kind,
    title: b.title,
    sort_order: b.sortOrder,
    published: b.published,
    display_from:  orNull(b.displayFrom),
    display_until: orNull(b.displayUntil),
    attr_mode: b.attrMode,
    source_mode: b.sourceMode,
    source_section_id: b.sourceSectionId,
    source_page_id:    b.sourcePageId,
    source_content_id: b.sourceContentId,
    content_ids: b.contentIds,
    config: b.config as unknown as Json,
    body_html: body,
  };

  if (b.id > 0) {
    const { error } = await supabase.from("home_blocks").update(row).eq("id", b.id);
    if (error) return { id: null, error: describeHomeDbError(error) };
    await replaceBlockAttrs(b.id, b.attrIds);
    return { id: b.id };
  }
  const { data, error } = await supabase.from("home_blocks").insert(row).select("id").single();
  if (error || !data) return { id: null, error: describeHomeDbError(error) };
  await replaceBlockAttrs(data.id, b.attrIds);
  return { id: data.id };
}

export async function setHomeBlockPublished(id: number, published: boolean): Promise<void> {
  const { error } = await supabase.from("home_blocks").update({ published }).eq("id", id);
  if (error) throw error;
}

/** 論理削除（物理削除しない。develop.md §2-2） */
export async function deleteHomeBlock(id: number): Promise<void> {
  const { error } = await supabase.from("home_blocks").update({ is_deleted: true }).eq("id", id);
  if (error) throw error;
}

export async function saveHomeBlockOrder(items: { id: number; sortOrder: number }[]): Promise<void> {
  for (const it of items) {
    const { error } = await supabase.from("home_blocks")
      .update({ sort_order: it.sortOrder }).eq("id", it.id);
    if (error) throw error;
  }
}

/**
 * 片方のホームの構成を、もう片方へ複製する。
 *   ⚠️ 1回きりの複製で、以後は自動同期しない（片方だけ直したつもりが両方変わる事故を避ける）。
 *   複製先に既存のブロックがある場合は、その後ろに足す。
 */
export async function copyHomeBlocks(from: HomeAudience, to: HomeAudience): Promise<number> {
  const all = await fetchHomeBlocks();
  const src = all.filter((b) => b.audience === from).sort((a, z) => a.sortOrder - z.sortOrder);
  if (src.length === 0) return 0;
  const base = all.filter((b) => b.audience === to).length;

  let n = 0;
  for (let i = 0; i < src.length; i += 1) {
    const r = await saveHomeBlock({ ...src[i], id: 0, audience: to, sortOrder: base + i });
    if (r.id != null) n += 1;
  }
  return n;
}

/** Supabase のエラーを日本語にする。contents.ts の describeDbError と同じ方針。 */
export function describeHomeDbError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? "不明なエラー";
  const code = err?.code ?? "";
  if (code === "42501" || /row-level security/i.test(msg)) {
    return `権限がありません（管理者・オペレーターのみ保存できます）[${code || "42501"}]`;
  }
  if (code === "PGRST205" || code === "42P01" || /Could not find the table|relation .* does not exist/i.test(msg)) {
    return `ホームのテーブルがまだありません（マイグレーション未適用です）。supabase/migration_add_home_blocks.sql を実行してください: ${msg}`;
  }
  if (code === "PGRST204" || /Could not find the .* column/i.test(msg)) {
    return `DBに未追加の列があります（マイグレーション未適用の可能性）: ${msg}`;
  }
  if (code === "23514") return `入力値がDBの制約に違反しています: ${msg}`;
  if (code === "23503") return `参照先が存在しません（削除されたページ・コンテンツを指している可能性があります）: ${msg}`;
  return code ? `${msg} [${code}]` : msg;
}

// ── 新規ブロックの雛形 ──────────────────────────────────
/** 掲載期限の既定：今日から14日後（「作って置きっぱなし」を初期値の側で防ぐ） */
export function defaultDisplayUntil(days = 14): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 掲載期限が必須の種類（運営編集枠。更新が止まった瞬間に古びるもの） */
export const NEEDS_DEADLINE: readonly HomeBlockKind[] = ["hero", "html"];
export const needsDeadline = (b: HomeBlock): boolean =>
  NEEDS_DEADLINE.includes(b.kind) || (b.kind === "shelf" && b.sourceMode === "manual");

export function newHomeBlock(
  kind: HomeBlockKind, audience: HomeAudience, sortOrder: number, defaultTitle: string,
): HomeBlock {
  const withDeadline = NEEDS_DEADLINE.includes(kind);
  return {
    id: 0,
    audience,
    kind,
    title: defaultTitle,
    sortOrder,
    published: true,
    displayFrom: "",
    displayUntil: withDeadline ? defaultDisplayUntil() : "",
    attrMode: "any",
    attrIds: [],
    sourceMode: kind === "continue" || kind === "ranking" ? "auto" : "none",
    sourceSectionId: null,
    sourcePageId: null,
    sourceContentId: null,
    contentIds: [],
    config: {},
    bodyHtml: "",
  };
}

/** 掲載期限まであと何日か（運営の一覧で「残り5日」を出す）。期限なしは null */
export function daysLeft(b: HomeBlock, now = Date.now()): number | null {
  if (!b.displayUntil) return null;
  const t = Date.parse(b.displayUntil);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86400000);
}
