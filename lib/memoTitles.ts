// ============================================================
// メモタイトルマスタ（設定 ＞ マスタ管理 ＞ メモタイトル）
//
//   メンバーのメモは title_id でこのマスタを参照する（値のコピーではない）。
//   → ここで名称を変えれば、そのタイトルを使う既存メモの表示もすべて追従する。
//
//   運用のポイント
//     ・「無効化(is_active=false)」は削除ではない。新規選択の候補から外れるが、
//       既存メモの表示は保持される。物理削除すると参照先が消え表示不能になるため、
//       原則は無効化を使う（削除は未使用タイトルのみ）。
//
//   ⚠️ memo_titles は運営専用（RLS: is_ops()）。会員クライアントから import しない。
// ============================================================
import { supabase } from "./supabase";
import type { Tables, TablesInsert } from "./database.types";
import type { MemoTitle } from "./models";

// ── 変換 ──────────────────────────────────────────────────────
export function toMemoTitle(r: Tables<"memo_titles">): MemoTitle {
  return { id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active };
}

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchMemoTitles(): Promise<MemoTitle[]> {
  const { data, error } = await supabase
    .from("memo_titles")
    .select("*")
    .eq("is_deleted", false)
    .order("sort_order")
    .order("id");
  if (error || !data) return [];
  return data.map(toMemoTitle);
}

/** 新規選択に使えるタイトルだけ（無効は既存メモの表示には残るが、新規には出さない） */
export const activeMemoTitles = (list: MemoTitle[]): MemoTitle[] => list.filter((t) => t.isActive);

/** id → 名称の解決（未選択・移行漏れは "" を返す） */
export function memoTitleName(list: MemoTitle[], id: number | null): string {
  if (id == null) return "";
  return list.find((t) => t.id === id)?.name ?? "";
}

// ── 保存 ──────────────────────────────────────────────────────
export async function saveMemoTitle(t: MemoTitle): Promise<MemoTitle | null> {
  const row: TablesInsert<"memo_titles"> = {
    name: t.name.trim(),
    sort_order: t.sortOrder,
    is_active: t.isActive,
  };
  if (t.id > 0) {
    const { data, error } = await supabase
      .from("memo_titles").update(row).eq("id", t.id).select("*").single();
    if (error || !data) return null;
    return toMemoTitle(data);
  }
  const { data, error } = await supabase
    .from("memo_titles").insert(row).select("*").single();
  if (error || !data) return null;
  return toMemoTitle(data);
}

/** 表示順の一括反映（並べ替え用） */
export async function reorderMemoTitles(ids: number[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => supabase.from("memo_titles").update({ sort_order: i }).eq("id", id)),
  );
}

/**
 * 論理削除（is_deleted=true）。
 * 既存メモが参照している場合、title_id は on delete set null にしていないので
 * ここでは物理削除せず論理削除に倒す（証跡保持）。表示は名称フォールバックに委ねる。
 */
export async function deleteMemoTitle(id: number): Promise<void> {
  await supabase.from("memo_titles").update({ is_deleted: true, is_active: false }).eq("id", id);
}
