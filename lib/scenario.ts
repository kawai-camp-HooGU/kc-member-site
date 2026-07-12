// ============================================================
// シナリオ配信 データアクセス（クライアント）
//   CRUD（一覧/取得/保存/削除）・候補者数・訪問者集計
//   変数差し込み/URL抽出は lib/broadcast の共通関数を再利用
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { Scenario, ScenarioStep, ScenarioTrigger, StepDelayUnit, Member, SourceCategory } from "./models";
import { matchRecipient } from "./broadcast";
import type { SourceIndex } from "./sources";

// ── 変換 ──────────────────────────────────────────────────────
function toStep(r: Tables<"scenario_steps">): ScenarioStep {
  return {
    id: r.id, sortOrder: r.sort_order ?? 0,
    delayUnit: (r.delay_unit as StepDelayUnit) ?? "immediate",
    delayValue: r.delay_value ?? 0,
    timeOfDay: r.time_of_day ?? "",
    channelChat: r.channel_chat ?? true,
    channelEmail: r.channel_email ?? false,
    messageBody: r.message_body ?? "",
  };
}
function toScenario(r: Tables<"scenarios">, steps: ScenarioStep[]): Scenario {
  return {
    id: r.id, name: r.name ?? "", active: r.active ?? false,
    triggerType: (r.trigger_type as ScenarioTrigger) ?? "manual",
    targetSource: r.target_source ?? "",
    targetSourceIds:  Array.isArray(r.target_source_ids)  ? r.target_source_ids : [],
    targetSourceCats: Array.isArray(r.target_source_cats) ? (r.target_source_cats as SourceCategory[]) : [],
    targetAttrIds: Array.isArray(r.target_attr_ids) ? (r.target_attr_ids as number[]) : [],
    steps, createdAt: r.created_at ?? "",
  };
}

// ── 一覧（進行/完了の人数付き）────────────────────────────────
export interface ScenarioListItem extends Scenario { activeCount: number; doneCount: number; stepCount: number; }
export async function fetchScenarios(): Promise<ScenarioListItem[]> {
  const { data: rows } = await supabase.from("scenarios").select("*").order("id", { ascending: false });
  if (!rows) return [];
  const ids = rows.map((r) => r.id);
  const { data: steps } = await supabase.from("scenario_steps").select("*").in("scenario_id", ids.length ? ids : [-1]);
  const { data: entries } = await supabase.from("scenario_entries").select("scenario_id, status").in("scenario_id", ids.length ? ids : [-1]);
  return rows.map((r) => {
    const st = (steps ?? []).filter((s) => s.scenario_id === r.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(toStep);
    const es = (entries ?? []).filter((e) => e.scenario_id === r.id);
    return {
      ...toScenario(r, st),
      stepCount: st.length,
      activeCount: es.filter((e) => e.status === "active").length,
      doneCount: es.filter((e) => e.status === "done").length,
    };
  });
}

export async function fetchScenario(id: number): Promise<Scenario | null> {
  const { data: r } = await supabase.from("scenarios").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const { data: steps } = await supabase.from("scenario_steps").select("*").eq("scenario_id", id).order("sort_order");
  return toScenario(r, (steps ?? []).map(toStep));
}

// ── 保存（シナリオ＋ステップを丸ごと置換）─────────────────────
export async function saveScenario(s: Scenario): Promise<number | null> {
  const row = {
    name: s.name, active: s.active, trigger_type: s.triggerType,
    // Phase 3：経路は複数指定 ＋ カテゴリ一括。旧 target_source(text) はもう書かない。
    target_source_ids:  s.targetSourceIds,
    target_source_cats: s.targetSourceCats,
    target_attr_ids: s.targetAttrIds as unknown as Tables<"scenarios">["target_attr_ids"],
    updated_at: new Date().toISOString(),
  };
  let sid = s.id;
  if (sid > 0) {
    const { error } = await supabase.from("scenarios").update(row).eq("id", sid);
    if (error) return null;
    await supabase.from("scenario_steps").delete().eq("scenario_id", sid);
  } else {
    const { data, error } = await supabase.from("scenarios").insert(row).select("id").single();
    if (error || !data) return null;
    sid = data.id;
  }
  if (s.steps.length > 0) {
    const rows = s.steps.map((st, i) => ({
      scenario_id: sid, sort_order: i,
      delay_unit: st.delayUnit, delay_value: st.delayValue,
      time_of_day: st.timeOfDay || null,
      channel_chat: st.channelChat, channel_email: st.channelEmail,
      message_body: st.messageBody,
    }));
    const { error } = await supabase.from("scenario_steps").insert(rows);
    if (error) return null;
  }
  return sid;
}

export async function deleteScenario(id: number): Promise<void> {
  await supabase.from("scenarios").delete().eq("id", id);
}

// ── 候補者数（顧客のみ・条件一致）─────────────────────────────
export function scenarioCandidates(members: Member[], s: Scenario, index?: SourceIndex): Member[] {
  return members.filter((m) => matchRecipient(m, {
    targetMode: "filter",
    targetAttrIds: s.targetAttrIds,
    targetSourceIds: s.targetSourceIds,
    targetSourceCats: s.targetSourceCats,
  }, index));
}

// ── レポート（ステップ×URL 訪問者）───────────────────────────
export interface ScenarioLinkStat { linkId: number; stepId: number; url: string; clicks: number; uniques: number; }
export async function fetchScenarioLinks(scenarioId: number): Promise<ScenarioLinkStat[]> {
  const { data: links } = await supabase.from("scenario_links").select("*").eq("scenario_id", scenarioId);
  if (!links || links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const { data: clicks } = await supabase.from("scenario_clicks").select("link_id, member_id").in("link_id", ids);
  return links.map((l) => {
    const cs = (clicks ?? []).filter((c) => c.link_id === l.id);
    return { linkId: l.id, stepId: l.step_id, url: l.url, clicks: cs.length, uniques: new Set(cs.map((c) => c.member_id ?? -1)).size };
  });
}

export interface ScenarioVisitor { memberId: number | null; name: string; sourceId: number | null; attrIds: number[]; firstClick: string; lastClick: string; count: number; }
export async function fetchScenarioVisitors(linkId: number, members: Member[]): Promise<ScenarioVisitor[]> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const { data: clicks } = await supabase.from("scenario_clicks").select("member_id, clicked_at").eq("link_id", linkId).order("clicked_at", { ascending: true });
  const map = new Map<number, ScenarioVisitor>();
  for (const c of clicks ?? []) {
    const key = c.member_id ?? -1; const at = c.clicked_at ?? "";
    const cur = map.get(key);
    if (cur) { cur.count += 1; cur.lastClick = at; }
    else {
      const m = c.member_id != null ? byId.get(c.member_id) : undefined;
      map.set(key, { memberId: c.member_id ?? null, name: m?.name ?? "（不明）", sourceId: m?.sourceId ?? null, attrIds: m?.attrIds ?? [], firstClick: at, lastClick: at, count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
