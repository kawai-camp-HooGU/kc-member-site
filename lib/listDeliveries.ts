// ============================================================
// リストの配信履歴（クライアント：リスト管理画面の「配信履歴」タブ）
//   要件「配信で使用された場合、その履歴を参照可能とする」を満たす。
//
//   ⚠️ 件数・リスト名は**送信時点のスナップショット**。
//      後からリストを編集・改名・アーカイブしても、この履歴は変わらない。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { ListDelivery } from "./models";

function toBreakdown(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const num = typeof n === "number" ? n : Number(n);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

export function toListDelivery(r: Tables<"contact_list_deliveries">): ListDelivery {
  return {
    id: r.id,
    listId: r.list_id,
    kind: r.kind === "scenario" ? "scenario" : "broadcast",
    broadcastId: r.broadcast_id ?? null,
    scenarioId: r.scenario_id ?? null,
    listNameSnapshot: r.list_name_snapshot ?? "",
    titleSnapshot: r.title_snapshot ?? "",
    channel: r.channel ?? "email",
    targetCount: r.target_count ?? 0,
    sentCount: r.sent_count ?? 0,
    excludedCount: r.excluded_count ?? 0,
    excludedBreakdown: toBreakdown(r.excluded_breakdown),
    sentAt: r.sent_at ?? "",
  };
}

/** そのリストが宛先に使われた配信の履歴（新しい順） */
export async function fetchListDeliveries(listId: number): Promise<ListDelivery[]> {
  const { data, error } = await supabase
    .from("contact_list_deliveries")
    .select("*")
    .eq("list_id", listId)
    .order("sent_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data.map(toListDelivery);
}

/** 除外内訳を「停止12・電話のみ24」のような1行にまとめる */
export function breakdownText(b: Record<string, number>, label: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!v) continue;
    parts.push(`${label[k] ?? k} ${v}`);
  }
  return parts.length > 0 ? parts.join("・") : "—";
}
