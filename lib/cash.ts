// ============================================================
// 入出金（cash_entries）＋ 消込（cash_allocations）
//
//   ＜この層の要点＞
//   ・入出金は「着金・送金 1件＝1行」。明細ではない。
//   ・売上経費の明細（payments / expenses / refunds）に対して、
//     どれにいくら充当したかを cash_allocations で持つ（1入金:N明細／1明細:M入金）。
//   ・差額（振込手数料など）は明細に按分せず、着金1件につき adjustments に1行だけ持つ。
//
//   ＜差額の考え方＞
//     差額 ＝ 充当額の合計 − 実着金額
//       正（＋）… 理論より少なく着金した＝手数料などが引かれた（よくある）
//       負（−）… 理論より多く着金した＝過入金
//     許容枠（既定 ±1,000円）に収まっていれば「振込手数料」として自動で区分を提案し、
//     超えていたら人が確認する（確認事項5a）。
//
//     調整の金額は**符号付き**で持つ。こうすると
//       充当額の合計 − 調整の合計 ＝ 実着金額
//     が常に成り立ち、保存された1件だけを見ても検算できる。
//     絶対値で持つと過入金（負の差額）を区分名でしか区別できなくなる。
//
//   ⚠️ 計算は純関数に切り出してある（calcDiff / suggestAdjustment / suggestByAmount /
//      autoMatchByExternalId / settlementMap）。DBに触らずテストできる状態を保つこと。
// ============================================================
import { supabase } from "./supabase";
import type {
  AdjustmentKind, AllocationSource, CashAdjustment, CashAllocation, CashEntry,
  Expense, Payment, PaymentMaster,
} from "./models";
import type { SaveResult } from "./payments";

// ── テーブル未作成の検知（マイグレーション未適用でも壊さない）──
let cashTable: boolean | null = null;
export const cashAvailable = (): boolean | null => cashTable;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "42P01"
    || err.code === "PGRST205"
    || msg.includes("does not exist")
    || msg.includes("could not find the table");
}

// ── 差額の許容枠 ─────────────────────────────────────────────
/** 既定の許容差額（円）。国内の振込手数料（〜990円）をカバーする（確認事項5a） */
export const DEFAULT_TOLERANCE = 1000;

export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  transfer_fee: "振込手数料",
  fee_diff: "決済手数料の誤差",
  withholding: "源泉徴収",
  fx: "為替差額",
  unknown: "過不足・原因不明",
};

/**
 * 差額 ＝ 充当額の合計 − 実着金額。
 * 正なら「理論より少なく着金した」＝手数料などで引かれた分。
 */
export function calcDiff(entryAmount: number, allocations: { amount: number }[]): number {
  const allocated = allocations.reduce((s, a) => s + (Math.round(a.amount) || 0), 0);
  return allocated - (Math.round(entryAmount) || 0);
}

/** 充当額の合計 */
export function sumAllocations(allocations: { amount: number }[]): number {
  return allocations.reduce((s, a) => s + (Math.round(a.amount) || 0), 0);
}

/** adjustments の合計（符号付き） */
export function sumAdjustments(adjustments: CashAdjustment[]): number {
  return adjustments.reduce((s, a) => s + (Math.round(a.amount) || 0), 0);
}

/**
 * 検算：充当額の合計 − 調整の合計 ＝ 実着金額 になっているか。
 * ここが合っていない入出金は「差額の行き先が決まっていない」状態なので保存させない。
 */
export function isBalanced(entryAmount: number, allocations: { amount: number }[], adjustments: CashAdjustment[]): boolean {
  return calcDiff(entryAmount, allocations) - sumAdjustments(adjustments) === 0;
}

/**
 * 差額から調整行を提案する。
 *
 *   ・差額0なら提案なし。
 *   ・許容枠内なら「振込手数料」として自動提案（auto=true）。
 *     決済サイトに振込手数料の設定があり、その額と一致すれば確度が高い。
 *   ・許容枠を超えていたら区分を "unknown" にし、auto=false で人の確認を促す。
 *
 * @returns 提案する調整行と、自動で確定してよいか
 */
export function suggestAdjustment(
  diff: number,
  site?: PaymentSiteLike | null,
  tolerance = DEFAULT_TOLERANCE,
): { adjustment: CashAdjustment | null; auto: boolean; reason: string } {
  const d = Math.round(diff) || 0;
  if (d === 0) return { adjustment: null, auto: true, reason: "差額はありません" };

  const abs = Math.abs(d);
  const within = abs <= tolerance;

  if (!within) {
    return {
      adjustment: { kind: "unknown", amount: d, memo: "" },
      auto: false,
      reason: `差額が許容枠（±${tolerance.toLocaleString("ja-JP")}円）を超えています。区分を確認してください`,
    };
  }

  // 過入金（負の差額）は手数料では説明できない
  if (d < 0) {
    return {
      adjustment: { kind: "unknown", amount: d, memo: "過入金" },
      auto: false,
      reason: "実着金額が充当額を上回っています（過入金）。区分を確認してください",
    };
  }

  const expected = Math.round(site?.transferFee ?? 0);
  const matched = expected > 0 && expected === abs;
  return {
    adjustment: {
      kind: "transfer_fee",
      amount: d,
      memo: matched ? "決済サイトの振込手数料と一致" : "",
    },
    auto: true,
    reason: matched
      ? "決済サイトに設定された振込手数料と一致しました"
      : `許容枠（±${tolerance.toLocaleString("ja-JP")}円）内のため、振込手数料として自動で区分しました`,
  };
}

/** suggestAdjustment が必要とする決済サイト設定の最小形 */
export interface PaymentSiteLike { transferFee: number }

// ── 消込の候補提示 ───────────────────────────────────────────
/** 消込の相手候補（売上・経費・返金を1つの形で扱う） */
export interface AllocCandidate {
  sourceType: AllocationSource;
  sourceId: number;
  label: string;
  /** 計上日 */
  accrualDate: string;
  /** 入出金予定日（無ければ ""） */
  expectedDate: string;
  siteId: number | null;
  /** 消込対象の金額（＝計上額。正の値） */
  amount: number;
  /** すでに消込済みの額 */
  settled: number;
  externalTxnId: string;
}

/** 残額（まだ消し込まれていない額） */
export const remainOf = (c: AllocCandidate): number => Math.max(0, c.amount - c.settled);

/**
 * 外部取引IDで自動消込する。
 *
 * 決済サイトのバッチ入金は、通帳に「ストライプジヤパン（カ」としか出ず金額も名義も一致しない。
 * そこで金額照合ではなく決済ID（ch_… / po_…）で確定一致させる。誤検知が原理的に起きない。
 *
 * @param txnIds 入金明細CSV等から得た外部取引IDの一覧
 */
export function autoMatchByExternalId(
  candidates: AllocCandidate[],
  txnIds: readonly string[],
): AllocCandidate[] {
  const want = new Set(txnIds.map((s) => s.trim()).filter(Boolean));
  if (!want.size) return [];
  return candidates.filter((c) => c.externalTxnId && want.has(c.externalTxnId.trim()));
}

/**
 * 金額から消込候補を提案する（貪欲法）。
 *
 * ⚠️ 総当たり（部分和）ではない。予定日の古い順に残額を積み上げ、
 *    目標額を超えない範囲で選ぶ。実務では「古い順にまとめて入金される」ため
 *    これで大半が当たるが、**確実な一致を保証するものではない**。
 *    最終的には人が確認する前提の「下書き」として使う。
 */
export function suggestByAmount(
  candidates: AllocCandidate[],
  targetAmount: number,
  tolerance = DEFAULT_TOLERANCE,
): AllocCandidate[] {
  const target = Math.round(targetAmount) || 0;
  if (target <= 0) return [];

  const open = candidates
    .filter((c) => remainOf(c) > 0)
    .sort((a, b) => {
      const da = a.expectedDate || a.accrualDate;
      const db = b.expectedDate || b.accrualDate;
      if (da !== db) return da < db ? -1 : 1;
      return a.sourceId - b.sourceId;
    });

  const picked: AllocCandidate[] = [];
  let sum = 0;
  for (const c of open) {
    const r = remainOf(c);
    // 目標＋許容枠を超えるものは飛ばす（別の入金の分とみなす）
    if (sum + r > target + tolerance) continue;
    picked.push(c);
    sum += r;
    if (Math.abs(target - sum) <= tolerance) break;
  }
  return picked;
}

// ── 消込状況の集計 ───────────────────────────────────────────
/** "payment:12" のような複合キー */
export const allocKey = (t: AllocationSource, id: number): string => `${t}:${id}`;

/**
 * 消込済み額のマップを作る。
 * 一覧側で「未入金／一部入金／入金済」を判定するのに使う。
 */
export function settlementMap(entries: CashEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    for (const a of e.allocations) {
      const k = allocKey(a.sourceType, a.sourceId);
      m.set(k, (m.get(k) ?? 0) + (Math.round(a.amount) || 0));
    }
  }
  return m;
}

// ── DB 変換 ──────────────────────────────────────────────────
interface EntryRow {
  id: number;
  direction: string | null;
  entry_date: string | null;
  site_id: number | null;
  account_name: string | null;
  amount: number | null;
  description: string | null;
  adjustments: unknown;
  external_payout_id: string | null;
  created_at: string | null;
}
interface AllocRow {
  id: number;
  cash_entry_id: number;
  source_type: string | null;
  source_id: number | null;
  amount: number | null;
}

const ADJ_KINDS: AdjustmentKind[] = ["transfer_fee", "fee_diff", "withholding", "fx", "unknown"];

/**
 * jsonb → CashAdjustment[]（壊れた値は捨てる。画面を落とさない）
 *
 * 金額の符号はそのまま残す。負＝過入金であり、絶対値にすると
 * 「充当額 − 調整 ＝ 実着金額」の検算が過入金のときだけ合わなくなる。
 */
export function parseAdjustments(raw: unknown): CashAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: CashAdjustment[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const kind = typeof o.kind === "string" && (ADJ_KINDS as string[]).includes(o.kind)
      ? (o.kind as AdjustmentKind) : "unknown";
    const amount = Math.round(Number(o.amount) || 0);
    if (amount === 0) continue;
    out.push({ kind, amount, memo: typeof o.memo === "string" ? o.memo : "" });
  }
  return out;
}

function toAllocation(r: AllocRow): CashAllocation {
  const t = r.source_type;
  return {
    id: r.id,
    cashEntryId: r.cash_entry_id,
    sourceType: t === "expense" || t === "refund" ? t : "payment",
    sourceId: r.source_id ?? 0,
    amount: r.amount ?? 0,
  };
}

function toEntry(r: EntryRow, allocs: CashAllocation[]): CashEntry {
  return {
    id: r.id,
    direction: r.direction === "out" ? "out" : "in",
    entryDate: (r.entry_date ?? "").slice(0, 10),
    siteId: r.site_id ?? null,
    accountName: r.account_name ?? "",
    amount: r.amount ?? 0,
    description: r.description ?? "",
    adjustments: parseAdjustments(r.adjustments),
    externalPayoutId: r.external_payout_id ?? "",
    createdAt: r.created_at ?? "",
    allocations: allocs,
  };
}

/** 未保存の新規入出金 */
export function newCashEntry(direction: "in" | "out" = "in"): CashEntry {
  return {
    id: 0, direction, entryDate: "", siteId: null, accountName: "",
    amount: 0, description: "", adjustments: [], externalPayoutId: "",
    createdAt: "", allocations: [],
  };
}

// ── CRUD ─────────────────────────────────────────────────────
export async function fetchCashEntries(): Promise<CashEntry[]> {
  const { data, error } = await supabase
    .from("cash_entries" as never).select("*").eq("is_deleted", false)
    .order("entry_date", { ascending: false }).order("id", { ascending: false });
  if (error) {
    if (isMissingTable(error)) { cashTable = false; return []; }
    throw error;
  }
  cashTable = true;
  const rows = (data ?? []) as unknown as EntryRow[];
  if (!rows.length) return [];

  const { data: aData, error: aErr } = await supabase
    .from("cash_allocations" as never).select("*")
    .in("cash_entry_id", rows.map((r) => r.id));
  if (aErr && !isMissingTable(aErr)) throw aErr;

  const byEntry = new Map<number, CashAllocation[]>();
  for (const a of ((aData ?? []) as unknown as AllocRow[])) {
    const al = toAllocation(a);
    const arr = byEntry.get(al.cashEntryId);
    if (arr) arr.push(al); else byEntry.set(al.cashEntryId, [al]);
  }
  return rows.map((r) => toEntry(r, byEntry.get(r.id) ?? []));
}

/**
 * 入出金と消込をまとめて保存する。
 *
 * ⚠️ Supabase クライアントからは複数テーブルをまたぐトランザクションを張れない。
 *    そこで「入出金を保存 → 既存の消込を全消し → 入れ直す」の順で行う。
 *    途中で失敗した場合は消込が消えたまま残りうるので、呼び出し側でエラーを必ず出すこと。
 *    （厳密な原子性が要るようになったら RPC（security definer）へ寄せる）
 */
export async function saveCashEntry(e: CashEntry): Promise<SaveResult> {
  const amount = Math.max(0, Math.round(e.amount) || 0);
  const row = {
    direction: e.direction,
    entry_date: e.entryDate || null,
    site_id: e.siteId,
    account_name: e.accountName,
    amount,
    description: e.description,
    adjustments: e.adjustments
      .map((a) => ({ kind: a.kind, amount: Math.round(a.amount) || 0, memo: a.memo }))
      .filter((a) => a.amount !== 0),
    external_payout_id: e.externalPayoutId ?? "",
  };

  const t = supabase.from("cash_entries" as never);
  const { data, error } = e.id
    ? await t.update(row as never).eq("id", e.id).select("id").maybeSingle()
    : await t.insert(row as never).select("id").single();
  if (error) {
    if (isMissingTable(error)) cashTable = false;
    return { id: null, error: error.message };
  }
  const id = e.id || (data as { id?: number } | null)?.id || null;
  if (id == null) return { id: null, error: "登録に失敗しました" };

  // 消込を入れ直す
  const del = await supabase.from("cash_allocations" as never).delete().eq("cash_entry_id", id);
  if (del.error && !isMissingTable(del.error)) {
    return { id: null, error: `消込の更新に失敗しました：${del.error.message}` };
  }
  const allocs = e.allocations
    .filter((a) => (Math.round(a.amount) || 0) > 0)
    .map((a) => ({
      cash_entry_id: id, source_type: a.sourceType,
      source_id: a.sourceId, amount: Math.round(a.amount),
    }));
  if (allocs.length) {
    const ins = await supabase.from("cash_allocations" as never).insert(allocs as never);
    if (ins.error) return { id: null, error: `消込の登録に失敗しました：${ins.error.message}` };
  }
  return { id };
}

export async function deleteCashEntry(id: number): Promise<void> {
  // 消込は on delete cascade だが、論理削除では消えないので明示的に外す
  await supabase.from("cash_allocations" as never).delete().eq("cash_entry_id", id);
  await supabase.from("cash_entries" as never).update({ is_deleted: true } as never).eq("id", id);
}

// ── 候補の組み立て ───────────────────────────────────────────
/**
 * 売上・経費から消込候補を作る。
 * direction="in" なら売上、"out" なら経費を対象にする。
 */
export function buildCandidates(
  direction: "in" | "out",
  payments: Payment[],
  expenses: Expense[],
  settled: Map<string, number>,
): AllocCandidate[] {
  if (direction === "in") {
    return payments.map((p) => ({
      sourceType: "payment" as const,
      sourceId: p.id,
      label: p.customerName || p.customerEmail || "（氏名なし）",
      accrualDate: p.accrualDate,
      expectedDate: p.expectedDate,
      siteId: p.siteId,
      amount: p.recognizedAmount || 0,
      settled: settled.get(allocKey("payment", p.id)) ?? 0,
      externalTxnId: p.externalTxnId,
    }));
  }
  return expenses.map((x) => ({
    sourceType: "expense" as const,
    sourceId: x.id,
    // 返金は実体こそ経費行だが、消し込む人には「返金」と見えていないと選べない（REQ-036）
    label: x.refundId != null
      ? `${x.vendorName || "（氏名なし）"}（返金）`
      : (x.vendorName || "（支払先なし）"),
    accrualDate: x.accrualDate,
    expectedDate: x.expectedDate,
    siteId: x.siteId,
    amount: x.recognizedAmount || 0,
    settled: settled.get(allocKey("expense", x.id)) ?? 0,
    externalTxnId: x.externalTxnId,
  }));
}
