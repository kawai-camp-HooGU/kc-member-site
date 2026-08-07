// ============================================================
// リッチメニュー公開処理（Phase 5b・サーバー専用）
//   ・レイアウト（cols×rows）＋セルのアクションから LINE の areas を計算。
//   ・公開：LINEに作成 → 画像アップロード → （既定なら）デフォルト設定。
//   ・削除：LINE上のリッチメニューを削除 → 行を論理削除。
//   画像は line-outbound（公開バケット）から取得する。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { getAccessToken } from "./lineAccountsServer";
import {
  createRichMenu, uploadRichMenuImage, setDefaultRichMenu, deleteRichMenu,
  linkRichMenu, unlinkRichMenu,
  type RichMenuArea, type RichMenuObject,
} from "./lineClient";
import { errMessage } from "./errors";

const OUTBOUND_BUCKET = "line-outbound";
const SIZE_DIMS: Record<string, { width: number; height: number }> = {
  full: { width: 2500, height: 1686 },
  compact: { width: 2500, height: 843 },
};

interface CellInput { label: string; actionType: "liff" | "liff_mypage" | "uri" | "message"; actionValue: string }

/** レイアウト（"cols x rows"）とセルから areas を計算。無効なアクションのセルは除外。 */
export function computeAreas(
  size: "full" | "compact", layout: string, cells: CellInput[], liffId: string
): RichMenuArea[] {
  const dim = SIZE_DIMS[size] ?? SIZE_DIMS.full;
  const m = /^(\d+)x(\d+)$/.exec(layout || "2x1");
  const cols = m ? Math.max(1, Number(m[1])) : 2;
  const rows = m ? Math.max(1, Number(m[2])) : 1;
  const areas: RichMenuArea[] = [];
  const count = cols * rows;
  for (let i = 0; i < count; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.round((col * dim.width) / cols);
    const y = Math.round((row * dim.height) / rows);
    const width = Math.round(((col + 1) * dim.width) / cols) - x;
    const height = Math.round(((row + 1) * dim.height) / rows) - y;

    let action: RichMenuArea["action"] | null = null;
    const label = cell.label?.trim() || undefined;
    if (cell.actionType === "liff") {
      if (liffId) action = { type: "uri", uri: `https://liff.line.me/${liffId}`, label };
    } else if (cell.actionType === "liff_mypage") {
      if (liffId) action = { type: "uri", uri: `https://liff.line.me/${liffId}/mypage`, label };
    } else if (cell.actionType === "uri") {
      if (cell.actionValue?.trim()) action = { type: "uri", uri: cell.actionValue.trim(), label };
    } else if (cell.actionType === "message") {
      const text = cell.actionValue?.trim() || cell.label?.trim();
      if (text) action = { type: "message", text, label };
    }
    if (action) areas.push({ bounds: { x, y, width, height }, action });
  }
  return areas;
}

async function loadImage(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const { data, error } = await supabaseAdmin.storage.from(OUTBOUND_BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return { bytes: buf, contentType };
}

/** 下書きをLINEに公開する。 */
export async function publishRichMenu(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabaseAdmin.from("line_rich_menus").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "リッチメニューが見つかりません" };
  if (!row.image_path) return { ok: false, error: "画像が未設定です" };

  const token = await getAccessToken(row.account_id);
  if (!token) return { ok: false, error: "アカウントの認証情報が未登録です" };

  const { data: acc } = await supabaseAdmin
    .from("line_accounts").select("liff_id").eq("id", row.account_id).maybeSingle();
  const liffId = acc?.liff_id ?? "";

  const size = row.size === "compact" ? "compact" : "full";
  const cells = (Array.isArray(row.cells) ? row.cells : []) as unknown as CellInput[];
  const areas = computeAreas(size, row.layout ?? "2x1", cells, liffId);
  if (areas.length === 0) return { ok: false, error: "タップ領域（アクション）が1つ以上必要です" };

  const img = await loadImage(row.image_path);
  if (!img) return { ok: false, error: "画像の取得に失敗しました" };

  const menu: RichMenuObject = {
    size: SIZE_DIMS[size],
    selected: false,
    name: (row.name || "richmenu").slice(0, 300),
    chatBarText: (row.chat_bar_text || "メニュー").slice(0, 14),
    areas,
  };

  try {
    // 旧リッチメニューがあれば削除してから作り直す
    if (row.rich_menu_id) await deleteRichMenu(token, row.rich_menu_id);
    const richMenuId = await createRichMenu(token, menu);
    await uploadRichMenuImage(token, richMenuId, img.bytes, img.contentType);
    if (row.is_default) {
      await setDefaultRichMenu(token, richMenuId);
      // 同一アカウントの他メニューの既定フラグを落とす
      await supabaseAdmin.from("line_rich_menus")
        .update({ is_default: false }).eq("account_id", row.account_id).neq("id", id);
    }
    await supabaseAdmin.from("line_rich_menus")
      .update({ rich_menu_id: richMenuId, status: "published", updated_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

// ── セグメント出し分け（Phase 7②）────────────────────────────
/**
 * 友だち1人に、条件に合う最優先のリッチメニューを個別リンクする。
 *   ・all（既定ベース）は per-user リンクしない（setDefault で全員に出る）。
 *   ・segment（unlinked/linked/attr）が一致すれば linkRichMenu、無ければ unlink（既定に戻す）。
 *   友だち追加・タグ変化・会員連携のタイミングから呼ぶ。例外は投げない。
 */
export async function applyRichMenuForFriend(friendId: number): Promise<void> {
  try {
    const { data: f } = await supabaseAdmin
      .from("line_friends").select("account_id, line_user_id, member_id, status").eq("id", friendId).maybeSingle();
    if (!f || f.status !== "friend" || f.account_id == null || !f.line_user_id) return;

    const { data: menus } = await supabaseAdmin
      .from("line_rich_menus")
      .select("rich_menu_id, audience, audience_attr_ids, priority")
      .eq("account_id", f.account_id).eq("is_deleted", false).eq("status", "published")
      .order("priority", { ascending: false });
    const segMenus = (menus ?? []).filter((m) => m.rich_menu_id && m.audience !== "all");

    const token = await getAccessToken(f.account_id);
    if (!token) return;

    // segment 判定に使う属性（連携済みは会員、未連携は友だち）
    const linked = f.member_id != null;
    let attrIds: number[] = [];
    if (segMenus.some((m) => m.audience === "attr")) {
      const q = linked
        ? supabaseAdmin.from("member_attributes").select("attribute_id").eq("member_id", f.member_id as number)
        : supabaseAdmin.from("member_attributes").select("attribute_id").eq("friend_id", friendId);
      const { data: a } = await q;
      attrIds = (a ?? []).map((r) => r.attribute_id);
    }

    const match = segMenus.find((m) => {
      if (m.audience === "linked") return linked;
      if (m.audience === "unlinked") return !linked;
      if (m.audience === "attr") return (m.audience_attr_ids ?? []).some((id: number) => attrIds.includes(id));
      return false;
    });

    if (match && match.rich_menu_id) await linkRichMenu(token, f.line_user_id, match.rich_menu_id);
    else await unlinkRichMenu(token, f.line_user_id);
  } catch (e) {
    console.error("applyRichMenuForFriend:", friendId, errMessage(e));
  }
}

/** 既定に設定（公開済みのみ）。 */
export async function setRichMenuDefault(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabaseAdmin.from("line_rich_menus").select("*").eq("id", id).maybeSingle();
  if (!row || !row.rich_menu_id) return { ok: false, error: "先に公開してください" };
  const token = await getAccessToken(row.account_id);
  if (!token) return { ok: false, error: "アカウントの認証情報が未登録です" };
  try {
    await setDefaultRichMenu(token, row.rich_menu_id);
    await supabaseAdmin.from("line_rich_menus").update({ is_default: false }).eq("account_id", row.account_id);
    await supabaseAdmin.from("line_rich_menus").update({ is_default: true }).eq("id", id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/** 削除（LINE上のメニューも削除）。 */
export async function deleteRichMenuRow(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabaseAdmin.from("line_rich_menus").select("account_id, rich_menu_id").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "見つかりません" };
  if (row.rich_menu_id) {
    const token = await getAccessToken(row.account_id);
    if (token) await deleteRichMenu(token, row.rich_menu_id);
  }
  await supabaseAdmin.from("line_rich_menus").update({ is_deleted: true }).eq("id", id);
  return { ok: true };
}
