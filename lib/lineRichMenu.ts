// ============================================================
// リッチメニュー データアクセス（クライアント安全）
//   ・一覧／下書き保存／画像アップロード … RLS(運営) で直接 supabase / storage
//   ・公開／既定設定／削除 … /api/line/richmenu（サーバーでLINE呼び出し）
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
import type { Tables } from "./database.types";
import type { LineRichMenu, RichMenuCell, RichMenuSize, RichMenuStatus, RichMenuAudience } from "./models";

const OUTBOUND_BUCKET = "line-outbound";

export function toRichMenu(r: Tables<"line_rich_menus">): LineRichMenu {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name ?? "",
    chatBarText: r.chat_bar_text ?? "メニュー",
    size: (r.size === "compact" ? "compact" : "full") as RichMenuSize,
    layout: r.layout ?? "2x1",
    imagePath: r.image_path ?? "",
    cells: Array.isArray(r.cells) ? (r.cells as unknown as RichMenuCell[]) : [],
    richMenuId: r.rich_menu_id ?? "",
    isDefault: r.is_default ?? false,
    status: (r.status === "published" ? "published" : "draft") as RichMenuStatus,
    audience: (["unlinked", "linked", "attr"].includes(r.audience) ? r.audience : "all") as RichMenuAudience,
    audienceAttrIds: Array.isArray(r.audience_attr_ids) ? r.audience_attr_ids : [],
    priority: r.priority ?? 0,
    abGroup: r.ab_group ?? "",
  };
}

/** メニューID→タップ数（計測リンク経由の集計）。 */
export async function fetchRichMenuTapCounts(accountId: number | null): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (accountId == null) return out;
  const { data: menus } = await supabase
    .from("line_rich_menus").select("id").eq("account_id", accountId).eq("is_deleted", false);
  const ids = (menus ?? []).map((m) => m.id);
  if (ids.length === 0) return out;
  const { data: taps } = await supabase.from("line_rich_menu_taps").select("menu_id").in("menu_id", ids);
  for (const t of taps ?? []) out.set(t.menu_id, (out.get(t.menu_id) ?? 0) + 1);
  return out;
}

export async function fetchRichMenus(accountId: number | null): Promise<LineRichMenu[]> {
  if (accountId == null) return [];
  const { data } = await supabase
    .from("line_rich_menus")
    .select("*")
    .eq("account_id", accountId)
    .eq("is_deleted", false)
    .order("id", { ascending: false });
  return (data ?? []).map(toRichMenu);
}

export interface SaveRichMenuInput {
  id?: number;
  accountId: number;
  name: string;
  chatBarText: string;
  size: RichMenuSize;
  layout: string;
  imagePath: string;
  cells: RichMenuCell[];
  isDefault: boolean;
  audience: RichMenuAudience;
  audienceAttrIds: number[];
  priority: number;
  abGroup: string;
}

/** 下書きの保存（新規は id を返す）。公開は別途 publishRichMenu。 */
export async function saveRichMenu(input: SaveRichMenuInput): Promise<number | null> {
  const row = {
    account_id: input.accountId,
    name: input.name,
    chat_bar_text: input.chatBarText,
    size: input.size,
    layout: input.layout,
    image_path: input.imagePath || null,
    cells: input.cells as unknown as Tables<"line_rich_menus">["cells"],
    is_default: input.isDefault,
    audience: input.audience,
    audience_attr_ids: input.audienceAttrIds,
    priority: input.priority,
    ab_group: input.abGroup,
    updated_at: new Date().toISOString(),
  };
  if (input.id && input.id > 0) {
    const { error } = await supabase.from("line_rich_menus").update(row).eq("id", input.id);
    return error ? null : input.id;
  }
  const { data, error } = await supabase.from("line_rich_menus").insert(row).select("id").single();
  return error || !data ? null : data.id;
}

/** リッチメニュー画像を公開バケットへアップロードし、パスを返す。 */
export async function uploadRichMenuImage(accountId: number, file: File): Promise<{ path: string; error?: string }> {
  if (!["image/jpeg", "image/png"].includes(file.type)) return { path: "", error: "画像はJPEGまたはPNGを選択してください" };
  if (file.size > 1024 * 1024) return { path: "", error: "画像は1MBまでです（LINE仕様）" };
  const ext = file.type === "image/jpeg" ? "jpg" : "png";
  const uid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID() : `${Date.now()}`;
  const path = `richmenu/${accountId}/${uid}.${ext}`;
  const up = await supabase.storage.from(OUTBOUND_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { path: "", error: "アップロードに失敗しました" };
  return { path };
}

/** 公開バケットの公開URL（プレビュー表示用）。 */
export function richMenuImageUrl(path: string): string {
  if (!path) return "";
  return supabase.storage.from(OUTBOUND_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/api/line/richmenu", { method: "POST", body });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? { ok: true } : { ok: false, error: j.error ?? "処理に失敗しました" };
}
export const publishRichMenu = (id: number) => post({ action: "publish", id });
export const setRichMenuDefault = (id: number) => post({ action: "default", id });
export const deleteRichMenu = (id: number) => post({ action: "delete", id });
