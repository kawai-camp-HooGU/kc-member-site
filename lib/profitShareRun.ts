// ============================================================
// 利益分配レポート：DB 側（マスタ・確定・スナップショット）
//
//   按分の計算は lib/profitShare.ts（純関数）。ここは Supabase を触る層だけ。
//
//   ＜月次の確定（ロック）＞
//   確定するとその月の分配額を share_entries に**スナップショットとして焼く**。
//   以降そのレポートは再計算せずスナップショットを読む。
//   確定後に売上や返金を直しても、支払い済みの分配額が勝手に変わらない。
//
//   確定した月は
//     ・分配額の再計算をしない
//     ・その月に計上された売上・経費の一括取込は取り消せない（設計書 §6-5）
//   の2つが効く。
//
//   ⚠️ テーブル未作成（マイグレーション未適用）でも画面は開く。
//      空を返して案内を出すだけにし、既存機能は止めない。
// ============================================================
import { supabase } from "./supabase";
import type { SaveResult } from "./payments";
import type { Partner, ShareEntry, SharePeriod, ShareRule } from "./models";

let shareTables: boolean | null = null;
export const shareAvailable = (): boolean | null => shareTables;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "42P01"
    || err.code === "PGRST205"
    || msg.includes("does not exist")
    || msg.includes("could not find the table");
}

// ── 分配先（partners）────────────────────────────────────────
function toPartner(r: Record<string, unknown>): Partner {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    memberId: r.member_id == null ? null : Number(r.member_id),
    parentPartnerId: r.parent_partner_id == null ? null : Number(r.parent_partner_id),
    note: String(r.note ?? ""),
    sortOrder: Number(r.sort_order ?? 0),
    isDeleted: !!r.is_deleted,
  };
}

export async function fetchPartners(includeHidden = true): Promise<Partner[]> {
  const q = supabase.from("partners" as never).select("*")
    .order("sort_order", { ascending: true }).order("id", { ascending: true });
  const { data, error } = includeHidden ? await q : await q.eq("is_deleted", false);
  if (error) { if (isMissingTable(error)) { shareTables = false; return []; } throw error; }
  shareTables = true;
  return ((data ?? []) as Record<string, unknown>[]).map(toPartner);
}

export function newPartner(): Partner {
  return { id: 0, name: "", email: "", memberId: null, parentPartnerId: null, note: "", sortOrder: 999, isDeleted: false };
}

export async function savePartner(p: Partner): Promise<SaveResult> {
  // 自分を自分の紹介元にはできない（循環の入口を塞ぐ）
  const parent = p.parentPartnerId != null && p.parentPartnerId === p.id ? null : p.parentPartnerId;
  const row = {
    name: p.name, email: p.email, member_id: p.memberId,
    parent_partner_id: parent, note: p.note,
    sort_order: Math.round(p.sortOrder) || 0, is_deleted: p.isDeleted,
  };
  const t = supabase.from("partners" as never);
  const { data, error } = p.id
    ? await t.update(row as never).eq("id", p.id).select("id").maybeSingle()
    : await t.insert(row as never).select("id").single();
  if (error) { if (isMissingTable(error)) shareTables = false; return { id: null, error: error.message }; }
  return { id: p.id || (data as { id?: number } | null)?.id || null };
}

/**
 * 紹介元のたどり先が循環していないか。
 * 循環すると 2ティア報酬の計算が無限に回る。保存前に画面で止める。
 */
export function hasCycle(partners: Partner[], id: number, parentId: number | null): boolean {
  if (parentId == null) return false;
  if (parentId === id) return true;
  const byId = new Map(partners.map((p) => [p.id, p]));
  const seen = new Set<number>([id]);
  let cur: number | null = parentId;
  while (cur != null) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentPartnerId ?? null;
  }
  return false;
}

// ── 分配ルール（profit_share_rules）──────────────────────────
function toRule(r: Record<string, unknown>): ShareRule {
  const round = r.rounding;
  return {
    id: Number(r.id),
    partnerId: Number(r.partner_id ?? 0),
    scope: r.scope === "type" ? "type" : "all",
    typeId: r.type_id == null ? null : Number(r.type_id),
    tier: r.tier === "first" || r.tier === "repeat" ? r.tier : "both",
    calc: r.calc === "fixed" ? "fixed" : "rate",
    rate: Number(r.rate ?? 0),
    fixedAmount: Number(r.fixed_amount ?? 0),
    parentRate: Number(r.parent_rate ?? 0),
    validFrom: String(r.valid_from ?? "").slice(0, 10),
    validTo: String(r.valid_to ?? "").slice(0, 10),
    priority: Number(r.priority ?? 0),
    rounding: round === "round" || round === "ceil" ? round : "floor",
    note: String(r.note ?? ""),
    isDeleted: !!r.is_deleted,
  };
}

export async function fetchShareRules(): Promise<ShareRule[]> {
  const { data, error } = await supabase.from("profit_share_rules" as never)
    .select("*").order("priority", { ascending: false }).order("id", { ascending: true });
  if (error) { if (isMissingTable(error)) { shareTables = false; return []; } throw error; }
  return ((data ?? []) as Record<string, unknown>[]).map(toRule);
}

export function newShareRule(partnerId = 0): ShareRule {
  return {
    id: 0, partnerId, scope: "all", typeId: null, tier: "both", calc: "rate",
    rate: 0, fixedAmount: 0, parentRate: 0, validFrom: "", validTo: "",
    priority: 0, rounding: "floor", note: "", isDeleted: false,
  };
}

export async function saveShareRule(r: ShareRule): Promise<SaveResult> {
  const row = {
    partner_id: r.partnerId,
    scope: r.scope,
    type_id: r.scope === "type" ? r.typeId : null,
    tier: r.tier,
    calc: r.calc,
    rate: r.calc === "rate" ? Math.max(0, Number(r.rate) || 0) : 0,
    fixed_amount: r.calc === "fixed" ? Math.max(0, Math.round(r.fixedAmount) || 0) : 0,
    parent_rate: Math.max(0, Number(r.parentRate) || 0),
    valid_from: r.validFrom || null,
    valid_to: r.validTo || null,
    priority: Math.round(r.priority) || 0,
    rounding: r.rounding,
    note: r.note,
    is_deleted: r.isDeleted,
  };
  const t = supabase.from("profit_share_rules" as never);
  const { data, error } = r.id
    ? await t.update(row as never).eq("id", r.id).select("id").maybeSingle()
    : await t.insert(row as never).select("id").single();
  if (error) { if (isMissingTable(error)) shareTables = false; return { id: null, error: error.message }; }
  return { id: r.id || (data as { id?: number } | null)?.id || null };
}

/** 入力チェック。画面から呼んで、保存前に止める */
export function validateRule(r: ShareRule): string[] {
  const out: string[] = [];
  if (!r.partnerId) out.push("分配先を選んでください");
  if (r.scope === "type" && r.typeId == null) out.push("商品種別を選んでください");
  if (r.calc === "rate") {
    if (r.rate <= 0) out.push("分配率を入力してください");
    if (r.rate > 100) out.push("分配率が100%を超えています");
  } else if (r.fixedAmount <= 0) out.push("固定額を入力してください");
  if (r.parentRate < 0 || r.parentRate > 100) out.push("紹介元への率は0〜100%で入力してください");
  if (r.calc === "rate" && r.rate + r.parentRate > 100) {
    out.push("分配率と紹介元への率の合計が100%を超えています");
  }
  if (r.validFrom && r.validTo && r.validFrom > r.validTo) out.push("適用期間の開始が終了より後になっています");
  return out;
}

// ── 月次の確定（share_periods / share_entries）───────────────
function toPeriod(r: Record<string, unknown>): SharePeriod {
  return {
    id: Number(r.id),
    period: String(r.period ?? ""),
    status: r.status === "fixed" ? "fixed" : "draft",
    fixedAt: String(r.fixed_at ?? ""),
    fixedBy: String(r.fixed_by ?? ""),
    totalBase: Number(r.total_base ?? 0),
    totalShare: Number(r.total_share ?? 0),
  };
}

export async function fetchSharePeriods(limit = 36): Promise<SharePeriod[]> {
  const { data, error } = await supabase.from("share_periods" as never)
    .select("*").order("period", { ascending: false }).limit(limit);
  if (error) { if (isMissingTable(error)) { shareTables = false; return []; } throw error; }
  shareTables = true;
  return ((data ?? []) as Record<string, unknown>[]).map(toPeriod);
}

/** 確定済みの月（"YYYY-MM"）の集合。取込の取消制限にも使う */
export async function fixedPeriods(): Promise<Set<string>> {
  const { data, error } = await supabase.from("share_periods" as never)
    .select("period, status").eq("status", "fixed");
  if (error) return new Set();
  return new Set(((data ?? []) as { period: string }[]).map((r) => r.period));
}

/** 確定済みの月のスナップショットを読む（再計算しない） */
export async function fetchShareEntries(period: string): Promise<ShareEntry[]> {
  const { data, error } = await supabase.from("share_entries" as never)
    .select("*").eq("period", period).order("id", { ascending: true });
  if (error) { if (isMissingTable(error)) shareTables = false; return []; }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    uid: String(r.uid ?? `${r.id}`),
    partnerId: Number(r.partner_id ?? 0),
    ruleId: Number(r.rule_id ?? 0),
    kind: r.kind === "refund" ? "refund" : "sale",
    tierKind: r.tier_kind === "parent" ? "parent" : "direct",
    sourceType: r.source_type === "refund" ? "refund" : "payment",
    sourceId: Number(r.source_id ?? 0),
    accrualDate: String(r.accrual_date ?? "").slice(0, 10),
    baseAmount: Number(r.base_amount ?? 0),
    amount: Number(r.amount ?? 0),
    note: String(r.note ?? ""),
  }));
}

export interface FixResult { ok: boolean; error?: string }

/**
 * 月次を確定し、分配額をスナップショットとして焼く。
 *
 * ⚠️ Supabase クライアントからは複数テーブルにまたがるトランザクションを張れない。
 *    「古いスナップショットを消す → 入れ直す → 期間を fixed にする」の順で行う。
 *    最後の1手が成功するまで status は draft のままなので、
 *    途中で失敗しても「中途半端に確定した月」は残らない。
 */
export async function fixPeriod(
  period: string,
  entries: ShareEntry[],
  totals: { base: number; share: number },
  fixedBy = "",
): Promise<FixResult> {
  const del = await supabase.from("share_entries" as never).delete().eq("period", period);
  if (del.error) {
    if (isMissingTable(del.error)) { shareTables = false; return { ok: false, error: "分配テーブルがまだありません" }; }
    return { ok: false, error: del.error.message };
  }

  const rows = entries.map((e) => ({
    period, uid: e.uid, partner_id: e.partnerId, rule_id: e.ruleId || null,
    kind: e.kind, tier_kind: e.tierKind,
    source_type: e.sourceType, source_id: e.sourceId,
    accrual_date: e.accrualDate || null,
    base_amount: Math.round(e.baseAmount) || 0,
    amount: Math.round(e.amount) || 0,
    note: e.note,
  }));
  const CHUNK = 200;
  for (let s = 0; s < rows.length; s += CHUNK) {
    const { error } = await supabase.from("share_entries" as never).insert(rows.slice(s, s + CHUNK) as never);
    if (error) return { ok: false, error: `明細の保存に失敗しました：${error.message}` };
  }

  const row = {
    period, status: "fixed",
    fixed_at: new Date().toISOString(), fixed_by: fixedBy,
    total_base: Math.round(totals.base) || 0,
    total_share: Math.round(totals.share) || 0,
  };
  const { error } = await supabase.from("share_periods" as never)
    .upsert(row as never, { onConflict: "period" } as never);
  if (error) return { ok: false, error: `確定に失敗しました：${error.message}` };
  return { ok: true };
}

/**
 * 確定を解除する。スナップショットも消す。
 * 支払い済みの月を戻す操作なので、画面側で必ず確認を取ること。
 */
export async function unfixPeriod(period: string): Promise<FixResult> {
  const { error } = await supabase.from("share_periods" as never)
    .update({ status: "draft", fixed_at: null, fixed_by: "" } as never).eq("period", period);
  if (error) return { ok: false, error: error.message };
  await supabase.from("share_entries" as never).delete().eq("period", period);
  return { ok: true };
}
