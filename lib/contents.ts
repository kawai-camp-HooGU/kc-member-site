// ============================================================
// コンテンツ機能のデータ層（ページ／コンテンツの取得・保存・公開条件判定）
//   動画・資料は URL 埋め込み方式（ファイル添付なし）。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { ContentPage, CmsContent, PublishMode } from "./models";
import type { AttrIndex } from "./members";

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";

// ── 取得 ──
export async function fetchContentData(): Promise<{ pages: ContentPage[]; contents: CmsContent[] }> {
  const [
    { data: pages, error: e1 },
    { data: contents, error: e2 },
    { data: pageAttrs, error: e3 },
    { data: contentAttrs, error: e4 },
  ] = await Promise.all([
    supabase.from("content_pages").select("*").eq("is_deleted", false).order("sort_order").order("id"),
    supabase.from("contents").select("*").eq("is_deleted", false).order("sort_order").order("id"),
    supabase.from("content_page_attributes").select("*"),
    supabase.from("content_attributes").select("*"),
  ]);
  if (e1 || e2) throw (e1 || e2);
  if (e3) console.warn("content_page_attributes 取得エラー:", e3);
  if (e4) console.warn("content_attributes 取得エラー:", e4);

  const pageAttrMap = new Map<number, number[]>();
  (pageAttrs ?? []).forEach((r) => { const a = pageAttrMap.get(r.page_id) ?? []; a.push(r.attribute_id); pageAttrMap.set(r.page_id, a); });
  const contentAttrMap = new Map<number, number[]>();
  (contentAttrs ?? []).forEach((r) => { const a = contentAttrMap.get(r.content_id) ?? []; a.push(r.attribute_id); contentAttrMap.set(r.content_id, a); });

  const toPage = (r: Tables<"content_pages">): ContentPage => ({
    id: r.id, name: r.name ?? "", abbr: r.abbr ?? "", createdAt: r.created_at ?? "",
    sortOrder: r.sort_order ?? 0, attrMode: asMode(r.attr_mode), attrIds: pageAttrMap.get(r.id) ?? [],
  });
  const toContent = (r: Tables<"contents">): CmsContent => ({
    id: r.id, pageId: r.page_id, name: r.name ?? "", createdAt: r.created_at ?? "",
    sortOrder: r.sort_order ?? 0, published: r.published ?? true, kind: (r.kind as CmsContent["kind"]) ?? "none",
    url: r.url ?? "", noneMode: (r.none_mode as CmsContent["noneMode"]) ?? "text",
    bodyText: r.body_text ?? "", bodyHtml: r.body_html ?? "", thumbUrl: r.thumb_url ?? "",
    attrMode: asMode(r.attr_mode), attrIds: contentAttrMap.get(r.id) ?? [],
  });
  return { pages: (pages ?? []).map(toPage), contents: (contents ?? []).map(toContent) };
}

// ── 保存 ──
async function replacePageAttrs(pageId: number, attrIds: number[]) {
  await supabase.from("content_page_attributes").delete().eq("page_id", pageId);
  if (attrIds.length) await supabase.from("content_page_attributes").insert(attrIds.map((id) => ({ page_id: pageId, attribute_id: id })));
}
async function replaceContentAttrs(contentId: number, attrIds: number[]) {
  await supabase.from("content_attributes").delete().eq("content_id", contentId);
  if (attrIds.length) await supabase.from("content_attributes").insert(attrIds.map((id) => ({ content_id: contentId, attribute_id: id })));
}

export async function savePage(p: ContentPage): Promise<number | null> {
  const row = { name: p.name, abbr: p.abbr, attr_mode: p.attrMode, sort_order: p.sortOrder };
  if (p.id) {
    const { error } = await supabase.from("content_pages").update(row).eq("id", p.id);
    if (error) { console.error(error); return null; }
    await replacePageAttrs(p.id, p.attrIds);
    return p.id;
  }
  const { data, error } = await supabase.from("content_pages").insert(row).select("id").single();
  if (error || !data) { console.error(error); return null; }
  await replacePageAttrs(data.id, p.attrIds);
  return data.id;
}

export async function deletePage(id: number): Promise<void> {
  await supabase.from("content_pages").update({ is_deleted: true }).eq("id", id);
}

/** @param aiAssisted AI(④)で本文HTMLを生成した場合 true（監査用フラグ） */
export async function saveContent(c: CmsContent, aiAssisted = false): Promise<number | null> {
  const row = {
    page_id: c.pageId, name: c.name, kind: c.kind, url: c.url, none_mode: c.noneMode,
    body_text: c.bodyText, body_html: c.bodyHtml, thumb_url: c.thumbUrl,
    published: c.published, attr_mode: c.attrMode, sort_order: c.sortOrder,
    ...(aiAssisted ? { ai_assisted: true } : {}),
  };
  if (c.id) {
    const { error } = await supabase.from("contents").update(row).eq("id", c.id);
    if (error) { console.error(error); return null; }
    await replaceContentAttrs(c.id, c.attrIds);
    return c.id;
  }
  const { data, error } = await supabase.from("contents").insert(row).select("id").single();
  if (error || !data) { console.error(error); return null; }
  await replaceContentAttrs(data.id, c.attrIds);
  return data.id;
}

export async function deleteContent(id: number): Promise<void> {
  await supabase.from("contents").update({ is_deleted: true }).eq("id", id);
}

export async function setPublished(id: number, published: boolean): Promise<void> {
  await supabase.from("contents").update({ published }).eq("id", id);
}

// ── 並び替え（sort_order 保存）──
export async function saveContentOrder(items: { id: number; sortOrder: number }[]): Promise<void> {
  await Promise.all(items.map((it) => supabase.from("contents").update({ sort_order: it.sortOrder }).eq("id", it.id)));
}
export async function savePageOrder(items: { id: number; sortOrder: number }[]): Promise<void> {
  await Promise.all(items.map((it) => supabase.from("content_pages").update({ sort_order: it.sortOrder }).eq("id", it.id)));
}

// ── 公開条件判定 ──
// 対象タグ t を、メンバーが「含む」= メンバーのいずれかの属性が t 自身か t の配下
function memberCovers(memberAttrIds: number[], t: number, index: AttrIndex): boolean {
  return memberAttrIds.some((aid) => index.ancestors.get(aid)?.has(t));
}
/** 公開対象（属性＋モード）に対し、メンバーの属性が閲覧可能か。対象未指定＝全員可。 */
export function canView(targetAttrIds: number[], mode: PublishMode, memberAttrIds: number[], index: AttrIndex): boolean {
  if (!targetAttrIds.length) return true;
  const some  = targetAttrIds.some((t) => memberCovers(memberAttrIds, t, index));
  const every = targetAttrIds.every((t) => memberCovers(memberAttrIds, t, index));
  switch (mode) {
    case "any":   return some;
    case "all":   return every;
    case "exany": return !some;
    case "exall": return !every;
    default:      return true;
  }
}

// ── 埋め込みURL ──
/** YouTube の各種URLを埋め込み用URLに変換。YouTube以外はそのまま返す（iframe埋め込み想定）。 */
export function toEmbedUrl(url: string): string {
  if (!url) return "";
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return url;
}
export function isYouTube(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url || "");
}
