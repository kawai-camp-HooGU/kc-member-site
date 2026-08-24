// ============================================================
// ナレッジ検索（PJ 側の薄い層）
//   検索そのものは lib/ai-core/rag/retrieve.ts（Ph3で移設）。
//   ここには「PJ のテーブルを読む部分」だけを残す。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import "../bootstrap";
import { supabaseAdmin } from "../../supabaseAdmin";

export * from "../../ai-core/rag/retrieve";

const sb = supabaseAdmin as unknown as SupabaseClient;

/**
 * メンバーの属性IDを「祖先を含めた集合」に広げる。
 *
 *   ★ 情報漏えい防止の要。canView() の memberCovers（メンバー属性の祖先に
 *     対象属性が含まれるか）と同じ意味になるよう、メンバー側を祖先方向へ
 *     展開してから配列の包含で判定する。
 *   ⚠️ ここを変えると公開判定が変わる。lib/ai/context.ts の canView() と
 *      必ず対で見直すこと。
 *   ⚠️ attributes / member_attributes は PJ のテーブルなので Core には置かない。
 *      Core の retrieveKnowledge() には、展開済みの配列を値として渡す。
 */
export async function expandMemberAttrs(memberId: number): Promise<number[]> {
  const [{ data: mine }, { data: all }] = await Promise.all([
    sb.from("member_attributes").select("attribute_id").eq("member_id", memberId),
    sb.from("attributes").select("id, parent_id").eq("is_deleted", false),
  ]);
  const own = ((mine as { attribute_id: number }[] | null) ?? []).map((r) => r.attribute_id);
  const parent = new Map<number, number | null>();
  for (const a of (all as { id: number; parent_id: number | null }[] | null) ?? []) {
    parent.set(a.id, a.parent_id ?? null);
  }
  const out = new Set<number>();
  for (const id of own) {
    let cur: number | null | undefined = id;
    while (cur != null && !out.has(cur)) { out.add(cur); cur = parent.get(cur) ?? null; }
  }
  return [...out];
}
