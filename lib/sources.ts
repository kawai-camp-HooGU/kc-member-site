// ============================================================
// 流入経路マスタ（Phase 3）
//
//   BEFORE：経路の定義が app_settings.welcome_routes(JSON) に埋没していた。
//           members.source は自由テキストで FK も無く、タイポが増殖し、
//           マスタから消しても会員側に文字列が残る（孤児レコード）状態だった。
//
//   AFTER ：sources テーブルを第一級のマスタに昇格。
//           初回メッセージ・一斉配信・シナリオ・フォームは
//           「マスタを参照するだけ」になる。
//
//   ⚠️ sources は運営専用（RLS: is_ops()）。会員クライアントからは読めない。
//      会員画面でこのモジュールを import しないこと。
// ============================================================
import { supabase } from "./supabase";
import type { Json, Tables, TablesInsert } from "./database.types";
import type { FormAction, Source, SourceCategory, WelcomeMessage } from "./models";
import { DEFAULT_SOURCE_COLOR, SOURCE_CATEGORIES } from "./models";

// ── 変換 ──────────────────────────────────────────────────────
const toCategory = (v: string | null | undefined): SourceCategory =>
  (SOURCE_CATEGORIES as string[]).includes(v ?? "") ? (v as SourceCategory) : "other";

export function toSource(r: Tables<"sources">): Source {
  return {
    id:          r.id,
    key:         r.key,
    label:       r.label,
    category:    toCategory(r.category),
    landingPath: r.landing_path ?? "",
    utmSource:   r.utm_source ?? "",
    utmMedium:   r.utm_medium ?? "",
    utmCampaign: r.utm_campaign ?? "",
    color:       r.color || DEFAULT_SOURCE_COLOR,
    memo:        r.memo ?? "",
    isActive:    r.is_active,
    sortOrder:   r.sort_order,
    createdAt:   r.created_at ?? "",
    actions:     Array.isArray(r.actions) ? (r.actions as unknown as FormAction[]) : [],
    fireOnce:    r.fire_once ?? true,
  };
}

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchSources(): Promise<Source[]> {
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .eq("is_deleted", false)
    .order("sort_order")
    .order("id");
  if (error || !data) return [];
  return data.map(toSource);
}

/** 新規付与に使える経路だけ（停止中は既存の紐付けは残るが、新たには選ばせない） */
export const activeSources = (list: Source[]): Source[] => list.filter((s) => s.isActive);

/** 経路別の会員数（ビュー v_source_member_counts） */
export async function fetchSourceCounts(): Promise<Map<number, number>> {
  const { data } = await supabase.from("v_source_member_counts").select("source_id, member_count");
  return new Map((data ?? []).map((r) => [r.source_id, r.member_count]));
}

// ── 保存・削除 ────────────────────────────────────────────────
/** 新規は id を返す。key の重複は DB の unique 制約で弾かれる。 */
export async function saveSource(s: Source): Promise<number | null> {
  const row: TablesInsert<"sources"> = {
    key:          s.key.trim(),
    label:        s.label.trim() || s.key.trim(),
    category:     s.category,
    landing_path: s.landingPath.trim() || null,
    utm_source:   s.utmSource.trim() || null,
    utm_medium:   s.utmMedium.trim() || null,
    utm_campaign: s.utmCampaign.trim() || null,
    color:        s.color || DEFAULT_SOURCE_COLOR,
    memo:         s.memo.trim() || null,
    is_active:    s.isActive,
    sort_order:   s.sortOrder,
    actions:      (s.actions ?? []) as unknown as Json,
    fire_once:    s.fireOnce,
    updated_at:   new Date().toISOString(),
  };
  if (s.id > 0) {
    const { error } = await supabase.from("sources").update(row).eq("id", s.id);
    return error ? null : s.id;
  }
  const { data, error } = await supabase.from("sources").insert(row).select("id").single();
  return error || !data ? null : data.id;
}

/**
 * 論理削除。
 *   ⚠️ 物理削除しないのは、members.source_id の FK が切れて
 *      「どこから来た会員か」が永久に分からなくなるため。
 *      運用上は「停止（is_active=false）」を推奨し、削除は最終手段。
 */
export async function deleteSource(id: number): Promise<void> {
  await supabase.from("sources").update({ is_deleted: true, is_active: false }).eq("id", id);
}

// ── 初回メッセージ（経路別文面）────────────────────────────────
export async function fetchWelcomeMessages(): Promise<WelcomeMessage[]> {
  const { data } = await supabase.from("welcome_messages").select("*");
  return (data ?? []).map((r) => ({ sourceId: r.source_id, message: r.message ?? "" }));
}

export async function saveWelcomeMessage(sourceId: number, message: string): Promise<void> {
  const text = message.trim();
  if (!text) {
    await supabase.from("welcome_messages").delete().eq("source_id", sourceId);
    return;
  }
  await supabase.from("welcome_messages").upsert(
    { source_id: sourceId, message: text, updated_at: new Date().toISOString() },
    { onConflict: "source_id" },
  );
}

// ── 経路キーの自動生成 ────────────────────────────────────────
/**
 * 経路キー（?src= に載る識別子）をランダム生成する。
 *
 *   ⚠️ キー文字列そのものに意味は無い（resolveSourceId が完全一致で引くだけ）。
 *      人が考えると重複・タイポ・大文字小文字ゆれが起きるので、既定は自動生成。
 *      可読キーにしたい場合は画面上で手で書き換えられる（重複チェックあり）。
 *
 *   衝突確率：36^10 ≒ 3.6×10^15 通り。実運用の経路数では実質ゼロ。
 *   万一衝突しても DB の unique 制約で弾かれる。
 */
export function generateSourceKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const n = 10;
  let out = "";
  const g = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (g?.getRandomValues) {
    const buf = new Uint32Array(n);
    g.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += chars[buf[i] % chars.length];
  } else {
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `src_${out}`;
}

// ── 表示・URL ヘルパー ────────────────────────────────────────
export type SourceIndex = Map<number, Source>;
export const buildSourceIndex = (list: Source[]): SourceIndex => new Map(list.map((s) => [s.id, s]));

/** sources.id → 表示名（不明な id は「（不明な経路）」） */
export function sourceLabel(index: SourceIndex, id: number | null | undefined): string {
  if (id == null) return "";
  return index.get(id)?.label ?? "（不明な経路）";
}

/**
 * 公開 URL（LP・QR・広告に貼る URL）。
 *
 *   `/s/{key}` は計測用リダイレクタ（app/s/[key]/route.ts）。
 *   ・ログイン中の会員が踏んだ → 経路を記録し、経路アクションを発火してから誘導先へ転送
 *   ・未ログイン → 誘導先へ ?src= 付きで転送（従来どおりフォーム送信時に会員化・発火）
 *
 *   ⚠️ 誘導先へ直リンクしないのは、既存会員が踏んだクリックを拾えないため。
 *      配布済みの URL を活かすため、誘導先の ?src= も引き続き有効（両対応）。
 */
export function sourceUrl(s: Source, siteUrl?: string): string {
  const base = (siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return `${base}/s/${encodeURIComponent(s.key)}`;
}

/**
 * リダイレクト先（/s/{key} が最終的に転送する URL）。
 *   landingPath 未指定なら /login に ?src= を付ける。
 *   UTM が設定されていれば併せて付与する（広告の効果測定用）。
 */
export function sourceLandingUrl(s: Source, siteUrl?: string): string {
  const base = (siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const path = s.landingPath.trim() || "/login";
  const q = new URLSearchParams();
  q.set("src", s.key);
  if (s.utmSource)   q.set("utm_source", s.utmSource);
  if (s.utmMedium)   q.set("utm_medium", s.utmMedium);
  if (s.utmCampaign) q.set("utm_campaign", s.utmCampaign);
  return `${base}${path.startsWith("/") ? path : `/${path}`}?${q.toString()}`;
}

// ── ターゲティング判定（配信・シナリオ共通）──────────────────
export interface SourceTarget {
  /** sources.id の配列（空 = 経路で絞らない） */
  targetSourceIds: number[];
  /** カテゴリの配列（空 = カテゴリで絞らない） */
  targetSourceCats: SourceCategory[];
}

/**
 * 会員の流入経路がターゲット条件に合致するか。
 *
 *   ・ids と cats はどちらも「空なら条件なし」。
 *   ・両方指定した場合は OR（どちらかに合致すれば対象）。
 *     → 「7月セミナー」と「広告カテゴリ全部」に送る、という指定ができる。
 *   ・会員に経路が付いていない（sourceId=null）場合は、
 *     どちらか一方でも条件があれば対象外。
 */
export function matchSource(
  memberSourceId: number | null | undefined,
  target: SourceTarget,
  index: SourceIndex,
): boolean {
  const hasIds  = target.targetSourceIds.length > 0;
  const hasCats = target.targetSourceCats.length > 0;
  if (!hasIds && !hasCats) return true;                 // 条件なし＝全員通す
  if (memberSourceId == null) return false;             // 経路未設定は絞り込みの対象外

  if (hasIds && target.targetSourceIds.includes(memberSourceId)) return true;
  if (hasCats) {
    const cat = index.get(memberSourceId)?.category;
    if (cat && target.targetSourceCats.includes(cat)) return true;
  }
  return false;
}
