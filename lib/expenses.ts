// ============================================================
// 経費（expenses）＋ 経費科目マスタ クライアントロジック
//
//   売上（payments）のミラー。構造も画面もほぼ同じで、違いは1点だけ：
//     売上 … 顧客を members に照合する（member_id）
//     経費 … 支払先を名称で持つ（vendor_name）。過去の実績からサジェストする
//
//   ・支払サイト / 支払方法は payment_sites / payment_methods を売上と共用する
//     （確認事項6a）。経費科目だけ expense_categories を新設する。
//   ・出金予定日と支払手数料は、売上と同じ lib/paymentSites.ts の計算を使う。
//   ・テーブル自体がまだ無い環境（マイグレーション未適用）でも画面を壊さない。
//     fetch は空配列を返し、available() が false を返すので画面が案内を出す。
// ============================================================
import { supabase } from "./supabase";
import type { Expense, ExpenseCategory, PaymentMaster } from "./models";
import { calcExpectedDate, calcFee } from "./paymentSites";
import type { SaveResult } from "./payments";

// ── テーブル未作成の検知 ─────────────────────────────────────
//   null=未判定 / true=あり / false=なし（マイグレーション未適用）
let expensesTable: boolean | null = null;

/** 経費テーブルが使えるか。未判定は null */
export const expensesAvailable = (): boolean | null => expensesTable;

/** Postgres / PostgREST の「そのテーブルは無い」系エラーか */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "42P01"
    || err.code === "PGRST205"
    || msg.includes("does not exist")
    || msg.includes("could not find the table");
}

// ── 経費科目マスタ ───────────────────────────────────────────
interface CategoryRow {
  id: number; name: string | null; is_cost: boolean | null;
  note: string | null; sort_order: number | null; is_deleted: boolean | null;
}

function toCategory(r: CategoryRow): ExpenseCategory {
  return {
    id: r.id,
    name: r.name ?? "",
    isCost: !!r.is_cost,
    note: r.note ?? "",
    sortOrder: r.sort_order ?? 0,
    isDeleted: !!r.is_deleted,
  };
}

/** 経費科目一覧。includeHidden=true で非表示も含む（編集画面用） */
export async function fetchExpenseCategories(includeHidden = false): Promise<ExpenseCategory[]> {
  const t = supabase.from("expense_categories" as never);
  const q = includeHidden ? t.select("*") : t.select("*").eq("is_deleted", false);
  const { data, error } = await q.order("sort_order").order("id");
  if (error) {
    if (isMissingTable(error)) { expensesTable = false; return []; }
    throw error;
  }
  expensesTable = true;
  return ((data ?? []) as unknown as CategoryRow[]).map(toCategory);
}

export async function saveExpenseCategory(c: ExpenseCategory): Promise<SaveResult> {
  const row = {
    name: c.name, is_cost: !!c.isCost, note: c.note,
    sort_order: Math.round(c.sortOrder) || 0, is_deleted: !!c.isDeleted,
  };
  const t = supabase.from("expense_categories" as never);
  const { data, error } = c.id
    ? await t.update(row as never).eq("id", c.id).select("id").maybeSingle()
    : await t.insert(row as never).select("id").single();
  if (error) return { id: null, error: error.message };
  const id = c.id || (data as { id?: number } | null)?.id || null;
  return id == null ? { id: null, error: "登録に失敗しました" } : { id };
}

/** 非表示にする（参照は保持される） */
export async function hideExpenseCategory(id: number): Promise<void> {
  await supabase.from("expense_categories" as never).update({ is_deleted: true } as never).eq("id", id);
}

// ── 経費本体 ─────────────────────────────────────────────────
interface ExpenseRow {
  id: number;
  paid_at: string | null; accrual_date: string | null; expected_date: string | null;
  category_id: number | null; site_id: number | null; method_id: number | null;
  vendor_name: string | null; vendor_invoice_no: string | null;
  amount: number | null; fee_amount: number | null; recognized_amount: number | null;
  currency: string | null; note: string | null;
  is_fee_manual: boolean | null; is_date_manual: boolean | null;
  external_source: string | null; external_txn_id: string | null;
  receipt_path: string | null; created_at: string | null;
  refund_id: number | null;
}

function toExpense(r: ExpenseRow): Expense {
  const paidAt = (r.paid_at ?? "").slice(0, 16);
  return {
    id: r.id,
    paidAt,
    accrualDate: (r.accrual_date ?? paidAt.slice(0, 10)) || "",
    expectedDate: r.expected_date ?? "",
    categoryId: r.category_id ?? null,
    siteId: r.site_id ?? null,
    methodId: r.method_id ?? null,
    vendorName: r.vendor_name ?? "",
    vendorInvoiceNo: r.vendor_invoice_no ?? "",
    amount: r.amount ?? 0,
    feeAmount: r.fee_amount ?? 0,
    recognizedAmount: r.recognized_amount ?? 0,
    currency: r.currency ?? "JPY",
    note: r.note ?? "",
    isFeeManual: r.is_fee_manual ?? false,
    isDateManual: r.is_date_manual ?? false,
    externalSource: r.external_source ?? "",
    externalTxnId: r.external_txn_id ?? "",
    receiptPath: r.receipt_path ?? null,
    createdAt: r.created_at ?? "",
    refundId: r.refund_id ?? null,
  };
}

/** 未保存の新規経費 */
export function newExpense(): Expense {
  return {
    id: 0, paidAt: "", accrualDate: "", expectedDate: "",
    categoryId: null, siteId: null, methodId: null,
    vendorName: "", vendorInvoiceNo: "",
    amount: 0, feeAmount: 0, recognizedAmount: 0,
    currency: "JPY", note: "", isFeeManual: false, isDateManual: false,
    externalSource: "", externalTxnId: "", receiptPath: null, createdAt: "",
    refundId: null,
  };
}

export async function fetchExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from("expenses" as never).select("*").eq("is_deleted", false)
    .order("accrual_date", { ascending: false }).order("id", { ascending: false });
  if (error) {
    if (isMissingTable(error)) { expensesTable = false; return []; }
    throw error;
  }
  expensesTable = true;
  return ((data ?? []) as unknown as ExpenseRow[]).map(toExpense);
}

export async function saveExpense(e: Expense): Promise<SaveResult> {
  const amount = Math.max(0, Math.round(e.amount) || 0);
  const fee = Math.min(amount, Math.max(0, Math.round(e.feeAmount) || 0));
  const rec = e.recognizedAmount && e.recognizedAmount > 0
    ? Math.round(e.recognizedAmount)
    : Math.max(0, amount - fee);
  const row = {
    paid_at: e.paidAt ? e.paidAt : null,
    accrual_date: e.accrualDate || (e.paidAt ? e.paidAt.slice(0, 10) : null),
    expected_date: e.expectedDate || null,
    category_id: e.categoryId,
    site_id: e.siteId,
    method_id: e.methodId,
    vendor_name: e.vendorName,
    vendor_invoice_no: e.vendorInvoiceNo,
    amount,
    fee_amount: fee,
    recognized_amount: rec,
    currency: e.currency || "JPY",
    note: e.note,
    is_fee_manual: !!e.isFeeManual,
    is_date_manual: !!e.isDateManual,
    external_source: e.externalSource ?? "",
    external_txn_id: e.externalTxnId ?? "",
    receipt_path: e.receiptPath,
    refund_id: e.refundId,
  };
  const t = supabase.from("expenses" as never);
  const { data, error } = e.id
    ? await t.update(row as never).eq("id", e.id).select("id").maybeSingle()
    : await t.insert(row as never).select("id").single();
  if (error) {
    if (isMissingTable(error)) expensesTable = false;
    return { id: null, error: error.message };
  }
  const id = e.id || (data as { id?: number } | null)?.id || null;
  return id == null ? { id: null, error: "登録に失敗しました" } : { id };
}

export async function deleteExpense(id: number): Promise<void> {
  await supabase.from("expenses" as never).update({ is_deleted: true } as never).eq("id", id);
}

// ── 自動計算 ─────────────────────────────────────────────────
/**
 * 支払サイト・支払日・金額の変更に合わせて、自動計算の項目を作り直す。
 * 売上側の recalcPayment と同じ考え方（onChange から明示的に呼ぶ）。
 */
export function recalcExpense(
  e: Expense,
  sites: PaymentMaster[],
  holidays?: ReadonlySet<string>,
): Expense {
  const site = e.siteId != null ? sites.find((s) => s.id === e.siteId)?.site ?? null : null;
  const next: Expense = { ...e };
  if (!next.accrualDate && next.paidAt) next.accrualDate = next.paidAt.slice(0, 10);
  if (!next.isDateManual) next.expectedDate = calcExpectedDate(next.paidAt, site, holidays);
  if (!next.isFeeManual) {
    next.feeAmount = calcFee(next.amount, site);
    next.recognizedAmount = Math.max(0, (Math.round(next.amount) || 0) - next.feeAmount);
  }
  return next;
}

// ── 支払先のサジェスト ───────────────────────────────────────
/**
 * 過去の経費から支払先の候補を返す（前方・部分一致・重複除去）。
 * 支払先マスタを作らない代わりの入力補助（確認事項6a）。
 */
export function suggestVendors(list: Expense[], keyword: string, limit = 8): string[] {
  const k = (keyword ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    const v = (e.vendorName ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    if (k && !key.includes(k)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

// ── 返金由来の経費行（REQ-036）───────────────────────────────
/**
 * 返金・解約から自動生成された行か。
 *
 * 経費一覧（/ops/expenses）は「経費を手で入力する画面」なので、ここには出さない（確認事項6a）。
 * 横断して見るのは売上経費一覧の役割で、あちらでは「返金」区分として出る。
 */
export const isRefundExpense = (e: Expense): boolean => e.refundId != null;

/** 手入力の経費だけを残す（経費一覧・支払先サジェスト用） */
export const manualExpenses = (list: Expense[]): Expense[] => list.filter((e) => !isRefundExpense(e));

/** インボイス登録番号の形式チェック（T＋13桁）。空は「未入力」として true */
export function isValidInvoiceNo(s: string): boolean {
  const v = (s ?? "").trim();
  if (!v) return true;
  return /^T\d{13}$/.test(v);
}
