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
  // 「完了扱い」を変えた可能性がある。経費計上の判定に使うキャッシュを捨てる（REQ-036）
  clearRefundDoneCache();
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
  clearRefundDoneCache();
  await supabase.from("refund_masters").update({ is_deleted: true }).eq("id", id);
}

/** 完全削除（物理DELETE）。参照中の refunds の該当番号は on delete set null で null になり「不明」表示になる。 */
export async function hardDeleteRefundMaster(id: number): Promise<{ ok: boolean; error?: string }> {
  clearRefundDoneCache();
  const { error } = await supabase.from("refund_masters").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** 並べ替え：渡された順に sort_order を 1..n で振り直す（同一グループ内で使う）。 */
export async function reorderRefundMasters(orderedIds: number[]): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from("refund_masters").update({ sort_order: i + 1 }).eq("id", orderedIds[i]);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
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
    // REQ-036。マイグレーション未適用の環境では列そのものが来ないので ?? で受ける
    expenseCategoryId: r.expense_category_id ?? null,
    payoutSiteId: r.payout_site_id ?? null,
    payoutMethodId: r.payout_method_id ?? null,
    payoutExpectedDate: r.payout_expected_date ?? "",
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
    expense_category_id: r.expenseCategoryId,
    payout_site_id: r.payoutSiteId,
    payout_method_id: r.payoutMethodId,
    payout_expected_date: r.payoutExpectedDate ? r.payoutExpectedDate : null,
  };
  let id: number;
  if (r.id) {
    const { error } = await supabase.from("refunds").update(row).eq("id", r.id);
    if (error) return { id: null, error: error.message };
    id = r.id;
  } else {
    const { data, error } = await supabase.from("refunds").insert(row).select("id").single();
    if (error || !data) return { id: null, error: error?.message ?? "登録に失敗しました" };
    id = data.id;
  }
  // 経費行の生成・更新・取消。失敗しても返金の保存自体は成功として返す
  // （経費テーブルが無い環境でも返金の入力は使えるようにする）。
  await syncRefundExpense({ ...r, id });
  return { id };
}

export async function deleteRefund(id: number): Promise<void> {
  await supabase.from("refunds").update({ is_deleted: true }).eq("id", id);
  // 生成済みの経費行も一緒に落とす。残すと返金は消えたのに経費だけ計上され続ける
  await supabase.from("expenses" as never).update({ is_deleted: true } as never).eq("refund_id", id);
}

/**
 * 複数行をまとめて保存する。
 *
 * ⚠️ 1本の upsert にしない。upsert は「一部だけ失敗」を表現できず、
 *    1行の入力ミスで全行が保存されなくなる。ここは行ごとに順次保存し、
 *    通った行は保存済みに、落ちた行だけを呼び出し元へ返す
 *    （brand.md §4「取得できた分はそのまま表示する」と同じ考え方）。
 *    1会員あたり数件〜十数件なので順次実行の遅さは問題にならない。
 */
export async function saveRefunds(
  list: Refund[],
): Promise<{ ids: (number | null)[]; failed: { index: number; error: string }[] }> {
  const ids: (number | null)[] = [];
  const failed: { index: number; error: string }[] = [];
  for (let i = 0; i < list.length; i++) {
    const res = await saveRefund(list[i]);
    ids.push(res.id);
    if (res.id == null) failed.push({ index: i, error: res.error ?? "登録に失敗しました" });
  }
  return { ids, failed };
}

/** 会員に紐付いた未保存の返金・解約を作る（会員詳細の「＋ 追加」用） */
export function newRefundFor(memberId: number | null, name = "", email = ""): Refund {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  // datetime-local の値は "YYYY-MM-DDTHH:mm"。UTC変換すると9時間ずれるのでローカルで組む
  const local = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}:${p2(now.getMinutes())}`;
  return {
    id: 0, memberId, paymentId: null, customerName: name, customerEmail: email,
    applicantName: "", applicantAddress: "", applicantEmail: "", applicantTel: "",
    cancelCat1Id: null, cancelCat2Id: null, statusId: null,
    kind: "refund", refundAmount: 0, expenseCategory: "refund",
    requestedAt: local, refundedAt: "", reason: "", progressMemo: "", note: "",
    screenshotPath: null, createdAt: "",
    expenseCategoryId: null, payoutSiteId: null, payoutMethodId: null, payoutExpectedDate: "",
  };
}

/**
 * 出金予定日（"YYYY-MM-DD"）。
 * 明示指定が無ければ返金完了日を使う（確認事項8a）。資金繰りの並び順に使う。
 */
export function refundExpectedDate(r: Refund): string {
  return r.payoutExpectedDate || (r.refundedAt ? r.refundedAt.slice(0, 10) : "");
}

// ── 返金 → 経費行の同期（REQ-036・確認事項5b）─────────────────
//
//   返金が「完了扱いのステータス」かつ「返金完了日時あり」に到達したら、
//   expenses に実体行を1本持たせる（expenses.refund_id で 1:1）。
//
//   ＜なぜ実体行を作るのか＞
//     出金の消込（cash_allocations）は source_type = "expense" の経路が既にある。
//     返金を経費行にしておけば、消込・資金繰り・科目別集計のすべてに
//     追加のコード無しで乗る。返金だけ別扱いの分岐を各所に生やさずに済む。
//
//   ＜二重計上をどう防ぐか＞
//     売上経費一覧（lib/ledger.ts）は、経費行が有る返金については
//     refunds 側から行を作らない。行の実体は常に1本だけになる。
//     DB 側にも expenses(refund_id) の一意インデックスを張ってある。
//
//   ⚠️ 経費テーブルが無い環境（マイグレーション未適用）では黙って何もしない。
//      返金の入力そのものは従来どおり使えるようにする。

/** 完了扱いステータスIDのキャッシュ。保存のたびにマスタを引き直さないため */
let doneIdsCache: Set<number> | null = null;

/** キャッシュを捨てる（マスタ編集画面で完了扱いを変えたら呼ぶ） */
export function clearRefundDoneCache(): void { doneIdsCache = null; }

async function loadDoneIds(): Promise<Set<number>> {
  if (doneIdsCache) return doneIdsCache;
  const { data, error } = await supabase
    .from("refund_masters").select("id,is_done").eq("group_key", "refund_status");
  if (error) return new Set();
  const set = new Set((data ?? []).filter((m) => m.is_done).map((m) => m.id));
  doneIdsCache = set;
  return set;
}

/** その返金が経費として計上される状態か（完了扱い＋完了日時あり） */
export function isRefundBooked(r: Refund, doneIds: ReadonlySet<number>): boolean {
  return r.statusId != null && doneIds.has(r.statusId) && !!r.refundedAt;
}

/**
 * 返金1件ぶんの経費行を作る／直す／取り消す。
 *
 *   計上される状態  → 経費行を upsert（既にあれば内容を上書きし、論理削除を解除）
 *   計上されない状態 → 経費行があれば論理削除（下書きに戻ったときに経費だけ残さない）
 */
export async function syncRefundExpense(r: Refund): Promise<void> {
  if (!r.id) return;
  const doneIds = await loadDoneIds();
  const booked = isRefundBooked(r, doneIds);

  const { data: found, error: findErr } = await supabase
    .from("expenses" as never).select("id").eq("refund_id", r.id).maybeSingle();
  // 列もテーブルも無い環境ではここで落ちる。返金の保存を巻き込まないよう黙って戻る
  if (findErr) return;
  const existingId = (found as { id?: number } | null)?.id ?? null;

  if (!booked) {
    if (existingId) {
      await supabase.from("expenses" as never)
        .update({ is_deleted: true } as never).eq("id", existingId);
    }
    return;
  }

  const day = r.refundedAt.slice(0, 10);
  const amount = Math.max(0, Math.round(r.refundAmount) || 0);
  const row = {
    paid_at: r.refundedAt,
    accrual_date: day,                       // 計上月の基準。現行の売上レポートと同じ
    expected_date: refundExpectedDate(r) || day,
    category_id: r.expenseCategoryId,
    site_id: r.payoutSiteId,
    method_id: r.payoutMethodId,
    vendor_name: r.customerName || r.customerEmail || "（氏名なし）",
    amount,
    fee_amount: 0,                           // 返金に決済手数料は乗らない
    recognized_amount: amount,
    currency: "JPY",
    note: r.reason || r.note,
    // 自動計算に踏まれないよう手動扱いで固定する。
    // recalcExpense が走ると支払サイトから予定日と手数料を作り直してしまう
    is_fee_manual: true,
    is_date_manual: true,
    external_source: "refund",
    refund_id: r.id,
    is_deleted: false,
  };

  if (existingId) {
    await supabase.from("expenses" as never).update(row as never).eq("id", existingId);
  } else {
    await supabase.from("expenses" as never).insert(row as never);
  }
}

/** 返金1件ぶんの計上・消込状況（会員詳細のバッジ用） */
export interface RefundSettlement {
  /** 生成された経費行の番号。まだ無ければ null */
  expenseId: number | null;
  /** 経費計上額 */
  amount: number;
  /** 消込済み額 */
  settled: number;
}

/**
 * 返金の消込状況をまとめて引く（返金番号 → 状況）。
 *
 * 入出金の全件を読むと会員詳細の表示だけで一覧ぶんの通信が走るので、
 * 対象の返金から生まれた経費行だけに絞って2本のクエリで済ませる。
 * 経費・入出金のテーブルが無い環境では空の Map を返し、画面は消込欄を出さない。
 */
export async function fetchRefundSettlement(refundIds: number[]): Promise<Map<number, RefundSettlement>> {
  const out = new Map<number, RefundSettlement>();
  if (refundIds.length === 0) return out;

  const { data: exps, error: exErr } = await supabase
    .from("expenses" as never)
    .select("id,refund_id,recognized_amount")
    .in("refund_id", refundIds)
    .eq("is_deleted", false);
  if (exErr) return out;

  const rowsEx = (exps ?? []) as unknown as { id: number; refund_id: number | null; recognized_amount: number | null }[];
  const byExpense = new Map<number, number>();   // 経費番号 → 返金番号
  for (const e of rowsEx) {
    if (e.refund_id == null) continue;
    out.set(e.refund_id, { expenseId: e.id, amount: e.recognized_amount ?? 0, settled: 0 });
    byExpense.set(e.id, e.refund_id);
  }
  if (byExpense.size === 0) return out;

  const { data: allocs, error: alErr } = await supabase
    .from("cash_allocations" as never)
    .select("source_id,amount")
    .eq("source_type", "expense")
    .in("source_id", [...byExpense.keys()]);
  if (alErr) return out;   // 入出金テーブルが無い環境。消込0のまま返す

  for (const a of (allocs ?? []) as unknown as { source_id: number; amount: number | null }[]) {
    const rid = byExpense.get(a.source_id);
    if (rid == null) continue;
    const cur = out.get(rid);
    if (cur) cur.settled += Math.round(a.amount ?? 0) || 0;
  }
  return out;
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
