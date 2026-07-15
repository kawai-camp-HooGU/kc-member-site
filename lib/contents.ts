// ============================================================
// コンテンツ機能のデータ層（ページ／コンテンツの取得・保存・公開条件判定）
//   動画・資料は URL 埋め込み方式（ファイル添付なし）。
// ============================================================
import { supabase } from "./supabase";
import { sanitizeBodyHtml } from "./richText";
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
    id: r.id, name: r.name ?? "", abbr: r.abbr ?? "", overview: r.overview ?? "", createdAt: r.created_at ?? "",
    sortOrder: r.sort_order ?? 0, attrMode: asMode(r.attr_mode), attrIds: pageAttrMap.get(r.id) ?? [],
  });
  const toContent = (r: Tables<"contents">): CmsContent => ({
    id: r.id, pageId: r.page_id, name: r.name ?? "", createdAt: r.created_at ?? "",
    publicToken: r.public_token ?? "", isExternal: r.is_external ?? false,
    sortOrder: r.sort_order ?? 0, published: r.published ?? true, kind: (r.kind as CmsContent["kind"]) ?? "none",
    url: r.url ?? "", noneMode: (r.none_mode as CmsContent["noneMode"]) ?? "text",
    bodyText: r.body_text ?? "", bodyHtml: r.body_html ?? "", thumbUrl: r.thumb_url ?? "",
    attrMode: asMode(r.attr_mode), attrIds: contentAttrMap.get(r.id) ?? [],
    filePath: r.file_path ?? "", fileName: r.file_name ?? "", fileSize: r.file_size ?? 0,
  });
  return { pages: (pages ?? []).map(toPage), contents: (contents ?? []).map(toContent) };
}

// ── アップロード資料（PDF等）────────────────────────────────
//   実体は Storage のプライベートバケット（content-files）に置く。
//   ダウンロードURLの発行は /api/content/download（service role）だけが行い、
//   誰が落としたかを content_downloads に必ず残す。
export const CONTENT_BUCKET = "content-files";
/** 1ファイルの上限。Vercel の関数を通さない（ブラウザ→Storage 直上げ）ので大きめに取れる。 */
export const CONTENT_FILE_MAX = 50 * 1024 * 1024; // 50MB

export function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 資料をアップロードする（運営のみ。RLS でバケットへの insert を制限している）。
 * @returns Storage 上のパス。失敗時は null
 */
export async function uploadContentFile(file: File): Promise<{ path: string | null; error?: string }> {
  if (file.size > CONTENT_FILE_MAX) {
    return { path: null, error: `ファイルが大きすぎます（上限 ${formatBytes(CONTENT_FILE_MAX)}）` };
  }
  // 日本語ファイル名はパスに使えないので置換する（元の名前は file_name に保持）
  const safe = file.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
  const { error } = await supabase.storage.from(CONTENT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) return { path: null, error: error.message };
  return { path };
}

/** 資料の実体を削除する（差し替え・コンテンツ削除時） */
export async function removeContentFile(path: string): Promise<void> {
  if (!path) return;
  await supabase.storage.from(CONTENT_BUCKET).remove([path]);
}

/**
 * ダウンロード用の署名URLを取得する。
 *   閲覧可否の判定とログ記録はサーバー側（/api/content/download）で行う。
 *   ブラウザから直接 createSignedUrl を呼ばないのは、ログを必ず通すため。
 */
// mode="preview" … インライン表示用の署名URL（ダウンロードログは残さない）
// mode="download" … 保存用の署名URL（attachment）。押下時にダウンロードログを1件残す
export async function requestDownloadUrl(
  contentId: number,
  mode: "preview" | "download" = "download",
): Promise<{ url?: string; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/content/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ contentId, mode }),
    });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !json.url) return { error: json.error ?? "ダウンロードに失敗しました" };
    return { url: json.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ダウンロードに失敗しました" };
  }
}

// ── 公開URL ──
// コンテンツごとに一意のトークン（DBが新規登録時に自動発行・変更不可）。
// 外部公開ONのときは未ログインでも /c/{token} で閲覧できる。
export const contentPublicPath = (token: string): string => (token ? `/c/${token}` : "");

/** 公開URL（絶対URL）。SSR時は NEXT_PUBLIC_SITE_URL、ブラウザでは現在のオリジンを使う。 */
export function contentPublicUrl(token: string): string {
  if (!token) return "";
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");
  return `${base}${contentPublicPath(token)}`;
}

// ── 保存 ──
//   保存系は「失敗したら null」ではなく、原因つきの SaveResult を返す。
//   RLS拒否・列欠落（マイグレーション未適用）・FK違反は現場で頻発し、
//   かつ対処が全く異なるため、UIまで理由を運ぶ。
export type SaveResult =
  | { id: number; error?: undefined }
  | { id: null; error: string };

/** Supabase(PostgREST)のエラーを、対処が分かる日本語メッセージに変換する */
export function describeDbError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? "不明なエラー";
  const code = err?.code ?? "";

  // RLS拒否：ロール不足、または members.user_id が auth.uid() と紐付いていない
  if (code === "42501" || /row-level security/i.test(msg)) {
    return `権限がありません（管理者・オペレーターのみ保存できます）。ロールが正しい場合は members.user_id とログインユーザーの紐付けをご確認ください [${code || "42501"}]`;
  }
  // 列が無い＝スキーマキャッシュに存在しない → マイグレーション未適用
  if (code === "PGRST204" || /Could not find the .* column/i.test(msg)) {
    return `DBに未追加の列があります（マイグレーション未適用の可能性）。supabase/ のSQLを実行してください: ${msg}`;
  }
  // 外部キー違反：page_id が存在しない（ページ未作成・未選択）
  if (code === "23503") return `参照先が存在しません（ページが選択されていない可能性があります）: ${msg}`;
  // CHECK制約違反：kind / none_mode / attr_mode の値が不正
  if (code === "23514") return `入力値がDBの制約に違反しています: ${msg}`;
  // 一意制約違反
  if (code === "23505") return `既に同じデータが存在します: ${msg}`;
  return code ? `${msg} [${code}]` : msg;
}

async function replacePageAttrs(pageId: number, attrIds: number[]) {
  await supabase.from("content_page_attributes").delete().eq("page_id", pageId);
  if (attrIds.length) await supabase.from("content_page_attributes").insert(attrIds.map((id) => ({ page_id: pageId, attribute_id: id })));
}
async function replaceContentAttrs(contentId: number, attrIds: number[]) {
  await supabase.from("content_attributes").delete().eq("content_id", contentId);
  if (attrIds.length) await supabase.from("content_attributes").insert(attrIds.map((id) => ({ content_id: contentId, attribute_id: id })));
}

export async function savePage(p: ContentPage): Promise<SaveResult> {
  const row = { name: p.name, abbr: p.abbr, overview: p.overview || null, attr_mode: p.attrMode, sort_order: p.sortOrder };
  if (p.id) {
    const { error } = await supabase.from("content_pages").update(row).eq("id", p.id);
    if (error) { console.error("savePage(update)", error); return { id: null, error: describeDbError(error) }; }
    await replacePageAttrs(p.id, p.attrIds);
    return { id: p.id };
  }
  const { data, error } = await supabase.from("content_pages").insert(row).select("id").single();
  if (error || !data) { console.error("savePage(insert)", error); return { id: null, error: describeDbError(error) }; }
  await replacePageAttrs(data.id, p.attrIds);
  return { id: data.id };
}

export async function deletePage(id: number): Promise<void> {
  await supabase.from("content_pages").update({ is_deleted: true }).eq("id", id);
}

/** @param aiAssisted AI(④)で本文HTMLを生成した場合 true（監査用フラグ） */
export async function saveContent(c: CmsContent, aiAssisted = false): Promise<SaveResult> {
  // ⚠️ public_token は含めない。新規時はDBが自動発行し、更新時はトリガが変更を拒否する。
  const row = {
    page_id: c.pageId, name: c.name, kind: c.kind, url: c.url, none_mode: c.noneMode,
    body_text: c.bodyText, body_html: sanitizeBodyHtml(c.bodyHtml), thumb_url: c.thumbUrl,
    published: c.published, is_external: c.isExternal, attr_mode: c.attrMode, sort_order: c.sortOrder,
    file_path: c.filePath || null, file_name: c.fileName || null, file_size: c.fileSize || null,
    ...(aiAssisted ? { ai_assisted: true } : {}),
  };
  if (c.id) {
    const { error } = await supabase.from("contents").update(row).eq("id", c.id);
    if (error) { console.error("saveContent(update)", error); return { id: null, error: describeDbError(error) }; }
    await replaceContentAttrs(c.id, c.attrIds);
    return { id: c.id };
  }
  const { data, error } = await supabase.from("contents").insert(row).select("id").single();
  if (error || !data) { console.error("saveContent(insert)", error); return { id: null, error: describeDbError(error) }; }
  await replaceContentAttrs(data.id, c.attrIds);
  return { id: data.id };
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

// ── 画像URL ──
/**
 * サムネイル画像URLを「ブラウザが直接表示できるURL」に正規化する。
 *
 *   運営が Google ドライブから普通にコピーしてくるのは閲覧ページのURL
 *     https://drive.google.com/file/d/{ID}/view?usp=sharing
 *   で、これは画像ではなく HTML を返すため <img> では表示できない（白い箱になる）。
 *   ドライブの画像配信エンドポイントに置き換える。
 *
 *   ⚠️ 前提：対象ファイルの共有設定が「リンクを知っている全員」であること。
 *      「制限付き」のままだと会員のブラウザからは 403 になる。
 */
/* ── サムネイルの推奨仕様 ─────────────────────────────────────
 *   一覧カード・詳細ヘッダー・公開ページの3か所すべてで枠の比率を揃える。
 *   枠：16:9 固定 ／ 画像は object-contain（切り抜かず全体表示）。
 *   そのため推奨サイズ以外の画像を入れても端が切れることはないが、
 *   余白（ぼかし帯）が出ないようにするには 16:9 の画像を用意すること。
 */
export const THUMB_ASPECT = "16 / 9";
export const THUMB_W = 1280;
export const THUMB_H = 720;
export const THUMB_HINT = `推奨サイズ：${THUMB_W}×${THUMB_H}px（16:9）／最小 640×360px`;

export function toImageUrl(url: string): string {
  if (!url) return "";
  const s = url.trim();

  // 既に配信用URLならそのまま
  if (/drive\.google\.com\/thumbnail\?/.test(s)) return s;
  if (/googleusercontent\.com\//.test(s)) return s;

  // https://drive.google.com/file/d/{ID}/view / open?id={ID} / uc?...id={ID}
  const m = s.match(/drive\.google\.com\/(?:file\/d\/([\w-]{20,})|open\?id=([\w-]{20,})|uc\?[^#]*\bid=([\w-]{20,}))/);
  const id = m?.[1] ?? m?.[2] ?? m?.[3];
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1200`;

  // Dropbox の共有URL（?dl=0）→ 直リンク
  if (/dropbox\.com\//.test(s)) {
    return s.replace(/([?&])dl=\d/, "$1raw=1") + (/[?&]raw=1/.test(s) ? "" : (s.includes("?") ? "&raw=1" : "?raw=1"));
  }
  return s;
}

/** Googleドライブの閲覧URLからファイルIDを取り出す（無ければ ""） */
export function driveFileId(url: string): string {
  const m = (url || "").match(/drive\.google\.com\/(?:file\/d\/([\w-]{20,})|open\?id=([\w-]{20,})|uc\?[^#]*\bid=([\w-]{20,})|thumbnail\?[^#]*\bid=([\w-]{20,}))/);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? "";
}

// ── 埋め込みURL ──
/**
 * 動画・資料のURLを iframe 埋め込み用に変換する。
 *   YouTube        … /embed/{id}
 *   Google ドライブ … /file/d/{ID}/preview（動画・PDF・画像すべて埋め込み可）
 *   それ以外        … そのまま
 */
export function toEmbedUrl(url: string): string {
  if (!url) return "";
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  const gd = driveFileId(url);
  if (gd) return `https://drive.google.com/file/d/${gd}/preview`;

  return url;
}
export function isYouTube(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url || "");
}
