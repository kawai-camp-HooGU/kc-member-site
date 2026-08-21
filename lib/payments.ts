// ============================================================
// 決済情報（payments）＋ 決済マスタ クライアントロジック
//
//   ・CRUD は RLS（運営のみ）で守られた supabase クライアントから直接行う。
//   ・商品種別 / 決済サイト / 決済方法は 3 マスタ。payments は番号（*_id）で参照し、
//     表示は番号→マスタで名称に解決する。
//   ・会員照合は members を email 一意突合 → 無ければ氏名の部分一致で候補提示。
//   ・売上計上金額は「決済金額 − 決済手数料」。手数料は決済サイトの率から自動計算する。
//   ・スクショは payment-shots（プライベート）へ圧縮して上げ、閲覧は署名URL経由。
//   ・AI 読取は名称で返るため、名称→マスタIDに突合してから反映する。
//   ・売上経費PL管理の追加列（計上日・入金予定日・手数料・外部取引ID）は、
//     マイグレーション未適用の環境でも画面が壊れないよう「あれば使う」で扱う。
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
import type { Payment, PaymentMaster, PaymentExtract } from "./models";
import type { Tables } from "./database.types";
import { calcExpectedDate, calcFee, DEFAULT_SITE_CONFIG, type PaymentSiteConfig } from "./paymentSites";

export interface SaveResult { id: number | null; error?: string }

// ── 売上経費PL管理の追加列（マイグレーション未適用でも壊さない）──────
//   database.types.ts は再生成前なので、追加列は Partial で被せて扱う。
//   保存時は一度そのまま送り、「その列は無い」エラーなら追加列を落として再送する。
//   一度判定したらモジュール内にキャッシュし、以降は無駄な往復をしない。
const PAYMENT_LEDGER_KEYS = [
  "accrual_date", "expected_date", "fee_amount",
  "is_fee_manual", "is_date_manual", "external_source", "external_txn_id",
] as const;
const SITE_LEDGER_KEYS = [
  "cycle_type", "closing_day", "month_offset", "payment_day", "offset_days",
  "day_type", "holiday_shift", "fee_rate", "fee_fixed", "fee_rounding",
  "transfer_fee", "auto_calc",
] as const;

/** 追加列がDBに存在するか。null=未判定 / true=あり / false=なし（旧スキーマ） */
let paymentLedgerCols: boolean | null = null;
let siteLedgerCols: boolean | null = null;

/** 追加列の有無。画面が「自動計算は未適用」と案内するのに使う（未判定は null） */
export const ledgerColumnsKnown = (): { payments: boolean | null; sites: boolean | null } =>
  ({ payments: paymentLedgerCols, sites: siteLedgerCols });

/** PostgREST / Postgres の「その列は無い」系エラーか */
function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "PGRST204"
    || err.code === "42703"
    || msg.includes("could not find the")
    || (msg.includes("column") && msg.includes("does not exist"));
}

function omitKeys<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) delete out[k];
  return out as T;
}

/** 追加列つきの payments 行（型の再生成前でも参照できるようにする） */
type PaymentRow = Tables<"payments"> & Partial<{
  accrual_date: string | null;
  expected_date: string | null;
  fee_amount: number | null;
  is_fee_manual: boolean | null;
  is_date_manual: boolean | null;
  external_source: string | null;
  external_txn_id: string | null;
}>;

/** 追加列つきの payment_sites 行 */
type SiteRow = Partial<{
  cycle_type: string | null; closing_day: number | null; month_offset: number | null;
  payment_day: number | null; offset_days: number | null; day_type: string | null;
  holiday_shift: string | null; fee_rate: number | string | null; fee_fixed: number | null;
  fee_rounding: string | null; transfer_fee: number | null; auto_calc: boolean | null;
}>;

/** 行 → 入金サイクル設定。未適用スキーマなら既定値（cycleType="none"）を返す */
export function toSiteConfig(r: SiteRow | null | undefined): PaymentSiteConfig {
  if (!r || r.cycle_type == null) return { ...DEFAULT_SITE_CONFIG };
  const cyc = r.cycle_type;
  return {
    cycleType: cyc === "offset" || cyc === "closing" || cyc === "periodic" ? cyc : "none",
    closingDay: Number(r.closing_day ?? 99),
    monthOffset: Number(r.month_offset ?? 1),
    paymentDay: Number(r.payment_day ?? 99),
    offsetDays: Number(r.offset_days ?? 0),
    dayType: r.day_type === "business" ? "business" : "calendar",
    holidayShift: r.holiday_shift === "before" || r.holiday_shift === "after" ? r.holiday_shift : "none",
    feeRate: Number(r.fee_rate ?? 0),
    feeFixed: Number(r.fee_fixed ?? 0),
    feeRounding: r.fee_rounding === "round" || r.fee_rounding === "ceil" ? r.fee_rounding : "floor",
    transferFee: Number(r.transfer_fee ?? 0),
    autoCalc: r.auto_calc !== false,
  };
}

/** 入金サイクル設定 → DB列 */
function fromSiteConfig(c: PaymentSiteConfig) {
  return {
    cycle_type: c.cycleType,
    closing_day: Math.round(c.closingDay),
    month_offset: Math.round(c.monthOffset),
    payment_day: Math.round(c.paymentDay),
    offset_days: Math.round(c.offsetDays),
    day_type: c.dayType,
    holiday_shift: c.holidayShift,
    fee_rate: Number(c.feeRate) || 0,
    fee_fixed: Math.round(c.feeFixed) || 0,
    fee_rounding: c.feeRounding,
    transfer_fee: Math.round(c.transferFee) || 0,
    auto_calc: !!c.autoCalc,
  };
}

// ── 決済マスタ ───────────────────────────────────────────────
export type MasterKind = "type" | "site" | "method";
const MASTER_TABLE: Record<MasterKind, "payment_product_types" | "payment_sites" | "payment_methods"> = {
  type: "payment_product_types", site: "payment_sites", method: "payment_methods",
};
export const MASTER_LABEL: Record<MasterKind, string> = { type: "商品種別", site: "決済サイト", method: "決済方法" };

function toMaster(
  r: { id: number; name: string; note: string; sort_order: number; is_deleted: boolean; sales_flag?: boolean; required_amount?: number },
  kind?: MasterKind,
): PaymentMaster {
  const m: PaymentMaster = {
    id: r.id, name: r.name ?? "", note: r.note ?? "", sortOrder: r.sort_order ?? 0, isDeleted: !!r.is_deleted,
    salesFlag: r.sales_flag, requiredAmount: r.required_amount,
  };
  if (kind === "site") {
    const row = r as SiteRow;
    // 追加列があるかは最初の読み込みで分かる。以降の保存の可否判定に使う。
    if (siteLedgerCols === null) siteLedgerCols = row.cycle_type !== undefined;
    m.site = toSiteConfig(row);
  }
  return m;
}

// 3マスタは共通操作。型は上位互換の payment_product_types として扱う
//   （sales_flag / required_amount は site/method には無いが、読取時 undefined・保存時は type のみ渡す）。
const masterTable = (kind: MasterKind) => supabase.from(MASTER_TABLE[kind] as "payment_product_types");

/** マスタ一覧。includeHidden=true で非表示（is_deleted）も含める（編集画面用）。 */
export async function fetchMasters(kind: MasterKind, includeHidden = false): Promise<PaymentMaster[]> {
  const t = masterTable(kind);
  const base = includeHidden ? t.select("*") : t.select("*").eq("is_deleted", false);
  const { data, error } = await base.order("sort_order").order("id");
  if (error) throw error;
  return (data ?? []).map((r) => toMaster(r, kind));
}

/** 選択肢用（表示中のみ）。3種まとめて取得。 */
export async function fetchMasterOptions(): Promise<{ types: PaymentMaster[]; sites: PaymentMaster[]; methods: PaymentMaster[] }> {
  const [types, sites, methods] = await Promise.all([fetchMasters("type"), fetchMasters("site"), fetchMasters("method")]);
  return { types, sites, methods };
}

export async function saveMaster(kind: MasterKind, m: PaymentMaster): Promise<SaveResult> {
  const base = { name: m.name, note: m.note, sort_order: m.sortOrder, is_deleted: m.isDeleted };
  const row: Record<string, unknown> = kind === "type"
    ? { ...base, sales_flag: m.salesFlag ?? true, required_amount: Math.max(0, Math.round(m.requiredAmount ?? 0)) }
    : { ...base };
  // 決済サイトは入金サイクル・手数料も保存する（列が無い環境では落として再送）
  const withCycle = kind === "site" && m.site && siteLedgerCols !== false;
  if (withCycle && m.site) Object.assign(row, fromSiteConfig(m.site));

  const t = masterTable(kind);
  const send = (r: Record<string, unknown>) => (m.id
    ? t.update(r as never).eq("id", m.id).select("id").maybeSingle()
    : t.insert(r as never).select("id").single());

  let { data, error } = await send(row);
  if (error && withCycle && isMissingColumn(error)) {
    // マイグレーション未適用。入金サイクル列を落として保存し直す
    siteLedgerCols = false;
    ({ data, error } = await send(omitKeys(row, SITE_LEDGER_KEYS)));
  }
  if (error) return { id: null, error: error.message };
  if (withCycle) siteLedgerCols = true;
  return { id: m.id || data?.id || null };
}

/** 非表示（削除フラグ）。参照は保持される（推奨）。 */
export async function hideMaster(kind: MasterKind, id: number): Promise<void> {
  await masterTable(kind).update({ is_deleted: true }).eq("id", id);
}
/** 完全削除（物理DELETE）。参照中の payments の該当番号は null になり表示が「不明」になる。 */
export async function hardDeleteMaster(kind: MasterKind, id: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await masterTable(kind).delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** 名称 → マスタ（表示中から case-insensitive 完全一致）。AI読取の突合に使う。 */
export function matchMasterByName(list: PaymentMaster[], name: string | undefined): PaymentMaster | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return list.find((m) => m.name.trim().toLowerCase() === n) ?? null;
}

// ── payments 変換 ────────────────────────────────────────────
function toPayment(row: Tables<"payments">): Payment {
  const r = row as PaymentRow;
  // 追加列の有無は最初の1行で判定する（未適用なら undefined が返る）
  if (paymentLedgerCols === null) paymentLedgerCols = r.accrual_date !== undefined;
  const paidAt = (r.paid_at ?? "").slice(0, 16);
  return {
    id: r.id,
    memberId: r.member_id,
    customerName: r.customer_name ?? "",
    customerKana: r.customer_kana ?? "",
    customerEmail: r.customer_email ?? "",
    customerTel: r.customer_tel ?? "",
    paidAt,
    typeId: r.type_id ?? null,
    siteId: r.site_id ?? null,
    methodId: r.method_id ?? null,
    amount: r.amount ?? 0,
    feeAmount: r.fee_amount ?? 0,
    recognizedAmount: r.recognized_amount ?? 0,
    currency: r.currency ?? "JPY",
    note: r.note ?? "",
    status: r.status === "matched" ? "matched" : "unmatched",
    screenshotPath: r.screenshot_path ?? null,
    createdAt: r.created_at ?? "",
    // 追加列。未適用スキーマでは計上日を決済日から補って表示だけ成立させる
    accrualDate: (r.accrual_date ?? paidAt.slice(0, 10)) || "",
    expectedDate: r.expected_date ?? "",
    // 既存行（手数料0・計上額あり）は自動再計算の対象外にする（過去の数字を動かさない）
    isFeeManual: r.is_fee_manual ?? ((r.fee_amount ?? 0) === 0 && (r.recognized_amount ?? 0) > 0),
    isDateManual: r.is_date_manual ?? false,
    externalSource: r.external_source ?? "",
    externalTxnId: r.external_txn_id ?? "",
  };
}

/**
 * 決済サイト・決済日・金額の変更に合わせて、自動計算の項目を作り直す。
 *
 *   ・入金予定日は isDateManual、手数料／計上額は isFeeManual が false のときだけ更新する。
 *   ・useEffect ではなく各 onChange から明示的に呼ぶこと。
 *     依存配列で回すと、編集途中の値で上書きして事故る。
 *
 * @param p        編集中の決済
 * @param sites    決済サイトマスタ一覧（p.siteId から引く）
 * @param holidays 祝日集合。省略時は土日のみ休業扱い
 */
export function recalcPayment(
  p: Payment,
  sites: PaymentMaster[],
  holidays?: ReadonlySet<string>,
): Payment {
  const site = p.siteId != null ? sites.find((s) => s.id === p.siteId)?.site ?? null : null;
  const next: Payment = { ...p };

  // 計上日は未設定なら決済日で埋める（手で入れてあれば触らない）
  if (!next.accrualDate && next.paidAt) next.accrualDate = next.paidAt.slice(0, 10);

  if (!next.isDateManual) {
    next.expectedDate = calcExpectedDate(next.paidAt, site, holidays);
  }
  if (!next.isFeeManual) {
    next.feeAmount = calcFee(next.amount, site);
    next.recognizedAmount = Math.max(0, (Math.round(next.amount) || 0) - next.feeAmount);
  }
  return next;
}

/** 未保存の新規決済 */
export function newPayment(): Payment {
  return {
    id: 0, memberId: null, customerName: "", customerKana: "", customerEmail: "", customerTel: "",
    paidAt: "", typeId: null, siteId: null, methodId: null,
    amount: 0, feeAmount: 0, recognizedAmount: 0,
    currency: "JPY", note: "", status: "unmatched", screenshotPath: null, createdAt: "",
    accrualDate: "", expectedDate: "", isFeeManual: false, isDateManual: false,
    externalSource: "", externalTxnId: "",
  };
}

export async function fetchPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments").select("*").eq("is_deleted", false)
    .order("paid_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toPayment);
}

export async function fetchMemberPayments(memberId: number): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments").select("*").eq("member_id", memberId).eq("is_deleted", false)
    .order("paid_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toPayment);
}

export async function savePayment(p: Payment): Promise<SaveResult> {
  const matched = p.memberId != null;
  const amount = Math.max(0, Math.round(p.amount) || 0);
  const fee = Math.min(amount, Math.max(0, Math.round(p.feeAmount) || 0));
  // 売上計上金額：明示があればそれを、無ければ「決済金額 − 手数料」
  const rec = p.recognizedAmount && p.recognizedAmount > 0
    ? Math.round(p.recognizedAmount)
    : Math.max(0, amount - fee);
  const row: Record<string, unknown> = {
    member_id: p.memberId,
    customer_name: p.customerName,
    customer_kana: p.customerKana,
    customer_email: p.customerEmail,
    customer_tel: p.customerTel,
    paid_at: p.paidAt ? p.paidAt : null,
    type_id: p.typeId,
    site_id: p.siteId,
    method_id: p.methodId,
    amount,
    recognized_amount: rec,
    currency: p.currency || "JPY",
    note: p.note,
    status: matched ? "matched" : "unmatched",
    screenshot_path: p.screenshotPath,
    matched_at: matched ? new Date().toISOString() : null,
    // ── 売上経費PL管理の追加列（未適用スキーマでは落として再送する）──
    accrual_date: p.accrualDate || (p.paidAt ? p.paidAt.slice(0, 10) : null),
    expected_date: p.expectedDate || null,
    fee_amount: fee,
    is_fee_manual: !!p.isFeeManual,
    is_date_manual: !!p.isDateManual,
    external_source: p.externalSource ?? "",
    external_txn_id: p.externalTxnId ?? "",
  };

  const withLedger = paymentLedgerCols !== false;
  const body = withLedger ? row : omitKeys(row, PAYMENT_LEDGER_KEYS);
  const send = (r: Record<string, unknown>) => (p.id
    ? supabase.from("payments").update(r as never).eq("id", p.id).select("id").maybeSingle()
    : supabase.from("payments").insert(r as never).select("id").single());

  let { data, error } = await send(body);
  if (error && withLedger && isMissingColumn(error)) {
    // マイグレーション未適用。追加列を落として保存し直す（既存機能は止めない）
    paymentLedgerCols = false;
    ({ data, error } = await send(omitKeys(row, PAYMENT_LEDGER_KEYS)));
  }
  if (error) return { id: null, error: error.message };
  if (withLedger) paymentLedgerCols = true;
  const id = p.id || data?.id || null;
  if (id == null) return { id: null, error: "登録に失敗しました" };
  return { id };
}

export async function deletePayment(id: number): Promise<void> {
  await supabase.from("payments").update({ is_deleted: true }).eq("id", id);
}

// ── 会員照合 ─────────────────────────────────────────────────
export interface MemberLite { id: number; name: string; email: string; company: string; role: string }

export async function matchMemberByEmail(email: string): Promise<MemberLite | null> {
  const e = (email ?? "").trim();
  if (!e) return null;
  const { data } = await supabase
    .from("members").select("id, name, email, company, role")
    .ilike("email", e).eq("is_deleted", false).limit(2);
  if (!data || data.length !== 1) return null;
  const m = data[0];
  return { id: m.id, name: m.name ?? "", email: m.email ?? "", company: m.company ?? "", role: m.role ?? "" };
}

export async function findMemberCandidates(keyword: string): Promise<MemberLite[]> {
  const k = (keyword ?? "").trim();
  if (!k) return [];
  const { data } = await supabase
    .from("members").select("id, name, email, company, role")
    .or(`name.ilike.%${k}%,email.ilike.%${k}%`).eq("is_deleted", false).limit(8);
  return (data ?? []).map((m) => ({
    id: m.id, name: m.name ?? "", email: m.email ?? "", company: m.company ?? "", role: m.role ?? "",
  }));
}

// ── 表示ヘルパー ─────────────────────────────────────────────
export function formatYen(n: number): string {
  return `¥${Math.round(n || 0).toLocaleString("ja-JP")}`;
}
/** 番号→名称（見つからなければ「不明(#id)」／未設定は "—"） */
export function nameOf(list: PaymentMaster[], id: number | null): string {
  if (id == null) return "—";
  const m = list.find((x) => x.id === id);
  return m ? m.name : `不明(#${id})`;
}

// ── スクショ（圧縮＋アップロード＋署名URL）──────────────────
export const PAYMENT_SHOT_BUCKET = "payment-shots";
export const PAYMENT_SHOT_MAX = 8 * 1024 * 1024;
const SHOT_MAX_EDGE = 1600;

export async function compressImage(file: File): Promise<Blob> {
  if (typeof document === "undefined" || !file.type.startsWith("image/")) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
    });
    const scale = Math.min(1, SHOT_MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { URL.revokeObjectURL(url); return file; }
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
    return blob ?? file;
  } catch { return file; }
}

export async function uploadPaymentShot(file: File): Promise<{ path: string | null; error?: string }> {
  if (file.size > PAYMENT_SHOT_MAX) return { path: null, error: "画像が大きすぎます（8MB以下にしてください）" };
  const blob = await compressImage(file);
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PAYMENT_SHOT_BUCKET)
    .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "image/jpeg" });
  if (error) return { path: null, error: error.message };
  return { path };
}

export async function removePaymentShot(path: string): Promise<void> {
  if (!path) return;
  await supabase.storage.from(PAYMENT_SHOT_BUCKET).remove([path]);
}

export async function requestShotUrl(paymentId: number): Promise<{ url?: string; error?: string }> {
  try {
    const res = await apiFetch("/api/payments/shot-url", { method: "POST", body: { paymentId } });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !json.url) return { error: json.error ?? "URLを発行できませんでした" };
    return { url: json.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "URLを発行できませんでした" };
  }
}

// ── AI スクショ読取 ─────────────────────────────────────────
export async function extractPaymentFromImage(file: File): Promise<{ data?: PaymentExtract; error?: string }> {
  try {
    const blob = await compressImage(file);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const res = await apiFetch("/api/ai/payment-extract", { method: "POST", body: { imageBase64: base64, mediaType: "image/jpeg" } });
    const json = (await res.json()) as { data?: PaymentExtract; error?: string };
    if (!res.ok) return { error: json.error ?? "読み取りに失敗しました" };
    return { data: json.data ?? {} };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "読み取りに失敗しました" };
  }
}
