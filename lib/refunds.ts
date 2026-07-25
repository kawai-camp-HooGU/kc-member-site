// ============================================================
// 返金・解約（refunds）＋ 返金解約マスタ クライアントロジック
//
//   ・CRUD は RLS（運営のみ）で守られた supabase クライアントから直接行う。
//   ・解約区分①/②・進捗ステータスは refund_masters（3グループ）。refunds は番号（*_id）で参照し、
//     表示は番号→マスタで名称に解決する。グループの表示名は refund_master_groups.label（編集可）。
//   ・会員照合は payments.ts のヘルパー（email 一意突合／氏名候補）を再利用する。
//   ・売上レポートでは refund_amount を「経費」として計上。対象は「完了扱い(is_done)」ステータス、
//     計上月は refunded_at を基準にする。
// ============================================================
import { supabase } from "./supabase";
import type { Refund, RefundMaster, RefundMasterGroup, RefundMasterGroupKey } from "./models";
import type { Tables } from "./database.types";

// 会員照合は決済と同じロジックを再利用する（重複実装しない）
export { matchMemberByEmail, findMemberCandidates, formatYen } from "./payments";
export type { MemberLite } from "./payments";

export interface SaveResult { id: number | null; error?: string }

// ── マスタ（グループ）────────────────────────────────────────
function toGroup(r: Tables<"refund_master_groups">): RefundMasterGroup {
  return { key: r.key as RefundMasterGroupKey, label: r.label ?? "", sortOrder: r.sort_order ?? 0 };
}

/** グループ表示名の一覧（解約区分①/②・進捗ステータスのラベル） */
export async function fetchRefundMasterGroups(): Promise<RefundMasterGroup[]> {
  const { data, error } = await supabase
    .from("refund_master_groups").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []).map(toGroup);
}

/** グループの表示名を更新（「解約区分①」等の名称そのものを編集） */
export async function saveRefundMasterGroupLabel(key: RefundMasterGroupKey, label: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("refund_master_groups").update({ label }).eq("key", key);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── マスタ（選択肢）────────────────────────────────────────
function toMaster(r: Tables<"refund_masters">): RefundMaster {
  return {
    id: r.id, groupKey: r.group_key as RefundMasterGroupKey, name: r.name ?? "", note: r.note ?? "",
    isDone: !!r.is_done, sortOrder: r.sort_order ?? 0, isDeleted: !!r.is_deleted,
  };
}

/** マスタ選択肢の一覧。includeHidden=true で非表示（is_deleted）も含める（編集画面用）。 */
export async function fetchRefundMasters(includeHidden = false): Promise<RefundMaster[]> {
  const base = includeHidden
    ? supabase.from("refund_masters").select("*")
    : supabase.from("refund_masters").select("*").eq("is_deleted", false);
  const { data, error } = await base.order("group_key").order("sort_order").order("id");
  if (error) throw error;
  return (data ?? []).map(toMaster);
}

/** 選択肢をグループ別に分けて返す（入力画面のセレクト用） */
export async function fetchRefundMasterOptions(): Promise<Record<RefundMasterGroupKey, RefundMaster[]>> {
  const all = await fetchRefundMasters(false);
  return {
    cancel_cat1:   all.filter((m) => m.groupKey === "cancel_cat1"),
    cancel_cat2:   all.filter((m) => m.groupKey === "cancel_cat2"),
    refund_status: all.filter((m) => m.groupKey === "refund_status"),
  };
}

export async function saveRefundMaster(m: RefundMaster): Promise<SaveResult> {
  const row = {
    group_key: m.groupKey, name: m.name, note: m.note,
    is_done: m.groupKey === "refund_status" ? !!m.isDone : false,
    sort_order: m.sortOrder, is_deleted: m.isDeleted,
  };
  if (m.id) {
    const { error } = await supabase.from("refund_masters").update(row).eq("id", m.id);
    if (error) return { id: null, error: error.message };
    return { id: m.id };
  }
  const { data, error } = await supabase.from("refund_masters").insert(row).select("id").single();
  if (error || !data) return { id: null, error: error?.message ?? "登録に失敗しました" };
  return { id: data.id };
}

/** 非表示（削除フラグ）。参照は保持（推奨）。 */
export async function hideRefundMaster(id: number): Promise<void> {
  await supabase.from("refund_masters").update({ is_deleted: true }).eq("id", id);
}

/** 番号 → 名称（見つからなければ「不明(#id)」／未設定は "—"） */
export function refundMasterName(list: RefundMaster[], id: number | null): string {
  if (id == null) return "—";
  const m = list.find((x) => x.id === id);
  return m ? m.name : `不明(#${id})`;
}

/** 完了扱いステータスの id 集合（経費計上・完了判定に使う） */
export function doneStatusIds(masters: RefundMaster[]): Set<number> {
  return new Set(masters.filter((m) => m.groupKey === "refund_status" && m.isDone).map((m) => m.id));
}

// ── refunds 変換 ─────────────────────────────────────────────
function toRefund(r: Tables<"refunds">): Refund {
  return {
    id: r.id,
    memberId: r.member_id,
    paymentId: r.payment_id,
    customerName: r.customer_name ?? "",
    customerEmail: r.customer_email ?? "",
    applicantName: r.applicant_name ?? "",
    applicantAddress: r.applicant_address ?? "",
    applicantEmail: r.applicant_email ?? "",
    applicantTel: r.applicant_tel ?? "",
    cancelCat1Id: r.cancel_cat1_id ?? null,
    cancelCat2Id: r.cancel_cat2_id ?? null,
    statusId: r.status_id ?? null,
    kind: (r.kind === "cancel" || r.kind === "both") ? r.kind : "refund",
    refundAmount: r.refund_amount ?? 0,
    expenseCategory: r.expense_category ?? "refund",
    requestedAt: (r.requested_at ?? "").slice(0, 16),
    refundedAt: (r.refunded_at ?? "").slice(0, 16),
    reason: r.reason ?? "",
    progressMemo: r.progress_memo ?? "",
    note: r.note ?? "",
    screenshotPath: r.screenshot_path ?? null,
    createdAt: r.created_at ?? "",
  };
}

export async function fetchRefunds(): Promise<Refund[]> {
  const { data, error } = await supabase
    .from("refunds").select("*").eq("is_deleted", false)
    .order("requested_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toRefund);
}

export async function fetchMemberRefunds(memberId: number): Promise<Refund[]> {
  const { data, error } = await supabase
    .from("refunds").select("*").eq("member_id", memberId).eq("is_deleted", false)
    .order("requested_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toRefund);
}

export async function saveRefund(r: Refund): Promise<SaveResult> {
  const matched = r.memberId != null;
  const row = {
    member_id: r.memberId,
    payment_id: r.paymentId,
    customer_name: r.customerName,
    customer_email: r.customerEmail,
    applicant_name: r.applicantName,
    applicant_address: r.applicantAddress,
    applicant_email: r.applicantEmail,
    applicant_tel: r.applicantTel,
    cancel_cat1_id: r.cancelCat1Id,
    cancel_cat2_id: r.cancelCat2Id,
    status_id: r.statusId,
    kind: r.kind,
    refund_amount: Math.max(0, Math.round(r.refundAmount || 0)),
    expense_category: r.expenseCategory || "refund",
    requested_at: r.requestedAt ? r.requestedAt : null,
    refunded_at: r.refundedAt ? r.refundedAt : null,
    reason: r.reason,
    progress_memo: r.progressMemo,
    note: r.note,
    screenshot_path: r.screenshotPath,
    matched_at: matched ? new Date().toISOString() : null,
  };
  if (r.id) {
    const { error } = await supabase.from("refunds").update(row).eq("id", r.id);
    if (error) return { id: null, error: error.message };
    return { id: r.id };
  }
  const { data, error } = await supabase.from("refunds").insert(row).select("id").single();
  if (error || !data) return { id: null, error: error?.message ?? "登録に失敗しました" };
  return { id: data.id };
}

export async function deleteRefund(id: number): Promise<void> {
  await supabase.from("refunds").update({ is_deleted: true }).eq("id", id);
}

// ── 売上レポート集計（経費）───────────────────────────────────
/** 完了扱いステータスの返金額合計（経費）。doneIds は doneStatusIds() の結果。 */
export function sumRefundExpense(rows: Refund[], doneIds: Set<number>): number {
  return rows.reduce((s, r) => s + (r.statusId != null && doneIds.has(r.statusId) ? (r.refundAmount || 0) : 0), 0);
}

/** 計上月（YYYY-MM）別の返金経費。refunded_at を基準にする。 */
export function refundExpenseByMonth(rows: Refund[], doneIds: Set<number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.statusId == null || !doneIds.has(r.statusId)) continue;
    const ym = (r.refundedAt || "").slice(0, 7);
    if (!ym) continue;
    out[ym] = (out[ym] ?? 0) + (r.refundAmount || 0);
  }
  return out;
}
