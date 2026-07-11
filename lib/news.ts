// ============================================================
// お知らせのデータ層（取得・保存・削除・公開切替・並び替え・公開判定）
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { NewsItem, NewsCategory, PublishMode, NoneMode } from "./models";
import { canView } from "./contents";
import { firePushNotify } from "./push";
import type { AttrIndex } from "./members";

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";
const asCat = (s: string | null | undefined): NewsCategory =>
  (s === "maint" || s === "event") ? s : "notice";
const asBody = (s: string | null | undefined): NoneMode => (s === "html" ? "html" : "text");

// timestamptz(ISO) → datetime-local 文字列
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
// datetime-local → ISO
const toIso = (local: string): string | null => {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// ── 取得 ──
export async function fetchNews(): Promise<NewsItem[]> {
  const [{ data, error }, { data: na, error: e2 }] = await Promise.all([
    supabase.from("news").select("*").eq("is_deleted", false).order("sort_order").order("id"),
    supabase.from("news_attributes").select("*"),
  ]);
  if (error) throw error;
  if (e2) console.warn("news_attributes 取得エラー:", e2);
  const attrMap = new Map<number, number[]>();
  (na ?? []).forEach((r) => { const a = attrMap.get(r.news_id) ?? []; a.push(r.attribute_id); attrMap.set(r.news_id, a); });
  const toItem = (r: Tables<"news">): NewsItem => ({
    id: r.id, category: asCat(r.category), title: r.title ?? "",
    bodyMode: asBody(r.body_mode), bodyText: r.body_text ?? "", bodyHtml: r.body_html ?? "",
    important: r.important ?? false, published: r.published ?? true,
    publishedAt: toLocalInput(r.published_at), attrMode: asMode(r.attr_mode),
    attrIds: attrMap.get(r.id) ?? [], sortOrder: r.sort_order ?? 0,
  });
  return (data ?? []).map(toItem);
}

// ── 保存 ──
async function replaceAttrs(newsId: number, attrIds: number[]) {
  await supabase.from("news_attributes").delete().eq("news_id", newsId);
  if (attrIds.length) await supabase.from("news_attributes").insert(attrIds.map((id) => ({ news_id: newsId, attribute_id: id })));
}

export async function saveNews(n: NewsItem): Promise<number | null> {
  const row = {
    category: n.category, title: n.title, body_mode: n.bodyMode, body_text: n.bodyText, body_html: n.bodyHtml,
    important: n.important, published: n.published, published_at: toIso(n.publishedAt), attr_mode: n.attrMode, sort_order: n.sortOrder,
  };
  // 新規公開／非公開→公開 になったときだけプッシュ通知する
  let wasPublished = false;
  if (n.id) {
    const { data: prev } = await supabase.from("news").select("published").eq("id", n.id).maybeSingle();
    wasPublished = prev?.published ?? false;
  }

  let savedId: number;
  if (n.id) {
    const { error } = await supabase.from("news").update(row).eq("id", n.id);
    if (error) { console.error(error); return null; }
    await replaceAttrs(n.id, n.attrIds);
    savedId = n.id;
  } else {
    const { data, error } = await supabase.from("news").insert(row).select("id").single();
    if (error || !data) { console.error(error); return null; }
    await replaceAttrs(data.id, n.attrIds);
    savedId = data.id;
  }

  if (n.published && !wasPublished) {
    firePushNotify({ kind: "news", newsId: savedId });
  }
  return savedId;
}

export async function deleteNews(id: number): Promise<void> {
  await supabase.from("news").update({ is_deleted: true }).eq("id", id);
}
export async function setNewsPublished(id: number, published: boolean): Promise<void> {
  await supabase.from("news").update({ published }).eq("id", id);
}
export async function saveNewsOrder(items: { id: number; sortOrder: number }[]): Promise<void> {
  await Promise.all(items.map((it) => supabase.from("news").update({ sort_order: it.sortOrder }).eq("id", it.id)));
}

// ── 掲載（ホーム）用フィルタ：公開中＋公開日時到来＋属性一致。重要→日時降順。 ──
export function visibleNews(all: NewsItem[], memberAttrIds: number[], index: AttrIndex, seeAll = false): NewsItem[] {
  const now = Date.now();
  return all
    .filter((n) => n.published)
    .filter((n) => { const t = n.publishedAt ? new Date(n.publishedAt).getTime() : 0; return isNaN(t) || t <= now; })
    .filter((n) => seeAll || canView(n.attrIds, n.attrMode, memberAttrIds, index))
    .sort((a, b) => (Number(b.important) - Number(a.important)) || b.publishedAt.localeCompare(a.publishedAt));
}
