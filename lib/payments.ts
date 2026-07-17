// ============================================================
// 決済情報（payments）＋ 決済マスタ クライアントロジック
//
//   ・CRUD は RLS（運営のみ）で守られた supabase クライアントから直接行う。
//   ・商品種別 / 決済サイト / 決済方法は 3 マスタ。payments は番号（*_id）で参照し、
//     表示は番号→マスタで名称に解決する。
//   ・会員照合は members を email 一意突合 → 無ければ氏名の部分一致で候補提示。
//   ・売上計上金額は、空/0 で登録した場合に決済金額を自動セットする。
//   ・スクショは payment-shots（プライベート）へ圧縮して上げ、閲覧は署名URL経由。
//   ・AI 読取は名称で返るため、名称→マスタIDに突合してから反映する。
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
import type { Payment, PaymentMaster, PaymentExtract } from "./models";
import type { Tables } from "./database.types";

export interface SaveResult { id: number | null; error?: string }

// ── 決済マスタ ───────────────────────────────────────────────
export type MasterKind = "type" | "site" | "method";
const MASTER_TABLE: Record<MasterKind, "payment_product_types" | "payment_sites" | "payment_methods"> = {
  type: "payment_product_types", site: "payment_sites", method: "payment_methods",
};
export const MASTER_LABEL: Record<MasterKind, string> = { type: "商品種別", site: "決済サイト", method: "決済方法" };

function toMaster(r: { id: number; name: string; note: string; sort_order: number; is_deleted: boolean; sales_flag?: boolean; required_amount?: number }): PaymentMaster {
  return {
    id: r.id, name: r.name ?? "", note: r.note ?? "", sortOrder: r.sort_order ?? 0, isDeleted: !!r.is_deleted,
    salesFlag: r.sales_flag, requiredAmount: r.required_amount,
  };
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
  return (data ?? []).map((r) => toMaster(r));
}

/** 選択肢用（表示中のみ）。3種まとめて取得。 */
export async function fetchMasterOptions(): Promise<{ types: PaymentMaster[]; sites: PaymentMaster[]; methods: PaymentMaster[] }> {
  const [types, sites, methods] = await Promise.all([fetchMasters("type"), fetchMasters("site"), fetchMasters("method")]);
  return { types, sites, methods };
}

export async function saveMaster(kind: MasterKind, m: PaymentMaster): Promise<SaveResult> {
  const base = { name: m.name, note: m.note, sort_order: m.sortOrder, is_deleted: m.isDeleted };
  const row = kind === "type"
    ? { ...base, sales_flag: m.salesFlag ?? true, required_amount: Math.max(0, Math.round(m.requiredAmount ?? 0)) }
    : base;
  const t = masterTable(kind);
  if (m.id) {
    const { error } = await t.update(row).eq("id", m.id);
    if (error) return { id: null, error: error.message };
    return { id: m.id };
  }
  const { data, error } = await t.insert(row).select("id").single();
  if (error || !data) return { id: null, error: error?.message ?? "登録に失敗しました" };
  return { id: data.id };
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
function toPayment(r: Tables<"payments">): Payment {
  return {
    id: r.id,
    memberId: r.member_id,
    customerName: r.customer_name ?? "",
    customerKana: r.customer_kana ?? "",
    customerEmail: r.customer_email ?? "",
    customerTel: r.customer_tel ?? "",
    paidAt: (r.paid_at ?? "").slice(0, 16),
    typeId: r.type_id ?? null,
    siteId: r.site_id ?? null,
    methodId: r.method_id ?? null,
    amount: r.amount ?? 0,
    recognizedAmount: r.recognized_amount ?? 0,
    currency: r.currency ?? "JPY",
    note: r.note ?? "",
    status: r.status === "matched" ? "matched" : "unmatched",
    screenshotPath: r.screenshot_path ?? null,
    createdAt: r.created_at ?? "",
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
  // 売上計上金額：空/0 のときは決済金額を自動セット
  const rec = p.recognizedAmount && p.recognizedAmount > 0 ? Math.round(p.recognizedAmount) : Math.round(p.amount || 0);
  const row = {
    member_id: p.memberId,
    customer_name: p.customerName,
    customer_kana: p.customerKana,
    customer_email: p.customerEmail,
    customer_tel: p.customerTel,
    paid_at: p.paidAt ? p.paidAt : null,
    type_id: p.typeId,
    site_id: p.siteId,
    method_id: p.methodId,
    amount: Math.round(p.amount) || 0,
    recognized_amount: rec,
    currency: p.currency || "JPY",
    note: p.note,
    status: matched ? "matched" : "unmatched",
    screenshot_path: p.screenshotPath,
    matched_at: matched ? new Date().toISOString() : null,
  };
  if (p.id) {
    const { error } = await supabase.from("payments").update(row).eq("id", p.id);
    if (error) return { id: null, error: error.message };
    return { id: p.id };
  }
  const { data, error } = await supabase.from("payments").insert(row).select("id").single();
  if (error || !data) return { id: null, error: error?.message ?? "登録に失敗しました" };
  return { id: data.id };
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
