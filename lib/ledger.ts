// ============================================================
// 売上経費／入金出金 統合一覧（ledger）
//
//   売上（payments）・経費（expenses）・返金（refunds）を1つの行型に正規化し、
//   抽出・集計・CSV書き出しまでを担う。画面は components/ledger/LedgerView.tsx。
//
//   ＜設計の要点＞
//   ・金額はDBでは常に正の値。符号はここ（表示層）で付ける。
//       売上 … netAmount = +計上額
//       経費・返金 … netAmount = −計上額
//     これで「マイナスの経費（＝返金の取消）」のような二重否定が起きない。
//   ・期間の基準日は3種類から選ぶ。同じデータを月次PL視点でも資金繰り視点でも見るため。
//       accrual  … 計上日（既定。月次PL・利益分配の軸）
//       paid     … 決済日・支払日
//       expected … 入出金予定日（資金繰り予測）
//   ・日付は "YYYY-MM-DD" の文字列比較で扱う。Date に変換するとタイムゾーンで
//     月初月末が1日ズレるため（lib/paymentSites.ts と同じ方針）。
//
//   ⚠️ この層は Supabase を直接触らない。取得済みの配列を受け取って加工する純関数に寄せ、
//      画面と集計ロジックを別々に検証できる状態を保つこと。
// ============================================================
import type { Expense, ExpenseCategory, Payment, PaymentMaster, Refund } from "./models";

// ── 行の型 ───────────────────────────────────────────────────
/** 行の区分。adjust は入出金の差額調整（P3b で入る） */
export type LedgerKind = "sales" | "expense" | "refund" | "adjust";

/**
 * 入出金の進み具合。消込（cash_allocations）の充当額から決まる。
 * 入出金が1件も無い／テーブル未作成のときは全行 "none" になる。
 */
export type SettleStatus = "none" | "partial" | "done";

export interface LedgerRow {
  /** 一覧内で一意（例 "sales:12"）。React の key に使う */
  uid: string;
  kind: LedgerKind;
  sourceId: number;
  /** 計上日（"YYYY-MM-DD"） */
  accrualDate: string;
  /** 決済日・支払日（"YYYY-MM-DD"） */
  paidDate: string;
  /** 入出金予定日（"YYYY-MM-DD"）。無ければ "" */
  expectedDate: string;
  /** 取引先・顧客の表示名 */
  partner: string;
  /** 科目・商品種別の表示名 */
  category: string;
  /**
   * 科目の絞り込みキー。売上は "t{商品種別id}"、経費は "c{経費科目id}"、返金は "refund"。
   * 売上と経費で別マスタなので、番号だけだと衝突する。接頭辞で分ける。
   */
  categoryKey: string;
  /** 決済／支払サイトの表示名 */
  siteName: string;
  /** 決済／支払サイトの番号（絞り込み用。未設定は null） */
  siteId: number | null;
  /** 売上金額（総額）。経費行は 0 */
  salesAmount: number;
  /** 経費金額（総額）。売上行は 0 */
  expenseAmount: number;
  /** 手数料（円・正の値） */
  feeAmount: number;
  /** 計上金額。売上＝正 / 経費・返金・調整＝負 */
  netAmount: number;
  settle: SettleStatus;
  /** 消込済みの額（円・正の値）。入出金がまだ無ければ 0 */
  settledAmount: number;
  note: string;
}

export const KIND_LABEL: Record<LedgerKind, string> = {
  sales: "売上", expense: "経費", refund: "返金", adjust: "調整",
};

export const SETTLE_LABEL: Record<SettleStatus, string> = {
  none: "未消込", partial: "一部", done: "完了",
};

// ── 抽出条件 ─────────────────────────────────────────────────
export type DateBase = "accrual" | "paid" | "expected";
export type PeriodPreset = "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "last12m" | "custom";

export interface LedgerFilter {
  base: DateBase;
  period: PeriodPreset;
  /** period="custom" のときだけ使う（"YYYY-MM-DD"） */
  from: string;
  to: string;
  kinds: LedgerKind[];
  /** 空配列＝すべて。値は LedgerRow.categoryKey と同じ形式 */
  categoryKeys: string[];
  /** 空配列＝すべて */
  siteIds: number[];
  settle: "all" | "unsettled" | "partial" | "done" | "overdue";
  keyword: string;
  minAmount: number | null;
  maxAmount: number | null;
}

export const ALL_KINDS: LedgerKind[] = ["sales", "expense", "refund", "adjust"];

export const DEFAULT_FILTER: LedgerFilter = {
  base: "accrual",
  period: "thisMonth",
  from: "", to: "",
  kinds: [...ALL_KINDS],
  categoryKeys: [], siteIds: [],
  settle: "all",
  keyword: "",
  minAmount: null, maxAmount: null,
};

// ── 日付ユーティリティ（TZ非依存・文字列で扱う）─────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 今日を "YYYY-MM-DD" で（ローカル日付＝運用者の感覚に合わせる） */
export function todayIso(): string {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * 相対指定を実際の期間に解決する。
 * 「当月」等で保存した条件は、開くたびに今日基準で計算し直される。
 */
export function resolvePeriod(f: LedgerFilter, today = todayIso()): { from: string; to: string } {
  if (f.period === "custom") return { from: f.from, to: f.to };
  const [ys, ms] = today.split("-");
  const y = Number(ys), m = Number(ms);

  switch (f.period) {
    case "thisMonth":
      return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case "thisQuarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1, qe = qs + 2;
      return { from: iso(y, qs, 1), to: iso(y, qe, lastDay(y, qe)) };
    }
    case "thisYear":
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    case "last12m": {
      const sy = m === 12 ? y : y - 1, sm = m === 12 ? 1 : m + 1;
      return { from: iso(sy, sm, 1), to: iso(y, m, lastDay(y, m)) };
    }
    default:
      return { from: "", to: "" };
  }
}

/** 行から基準日を取り出す。未設定なら計上日へフォールバック */
function baseDateOf(r: LedgerRow, base: DateBase): string {
  if (base === "paid") return r.paidDate || r.accrualDate;
  if (base === "expected") return r.expectedDate || r.accrualDate;
  return r.accrualDate;
}

// ── 正規化 ───────────────────────────────────────────────────
const nameOfMaster = (list: PaymentMaster[], id: number | null): string => {
  if (id == null) return "—";
  return list.find((m) => m.id === id)?.name ?? `不明(#${id})`;
};
const nameOfCategory = (list: ExpenseCategory[], id: number | null): string => {
  if (id == null) return "—";
  return list.find((c) => c.id === id)?.name ?? `不明(#${id})`;
};

export interface NormalizeInput {
  payments: Payment[];
  expenses: Expense[];
  refunds: Refund[];
  /** 完了扱いの返金ステータスID（refunds の doneStatusIds） */
  refundDoneIds: ReadonlySet<number>;
  types: PaymentMaster[];
  sites: PaymentMaster[];
  categories: ExpenseCategory[];
  /**
   * 消込済み額のマップ（`lib/cash.ts` の settlementMap）。キーは "payment:12" 形式。
   * 省略すると全行が未消込（settle="none"）になる。入出金テーブル未作成でも一覧は出る。
   */
  settled?: ReadonlyMap<string, number>;
}

/**
 * 消込額から入出金の進み具合を決める。
 * 端数の消込（充当額が1円多い等）で "partial" のまま残らないよう、
 * 計上額以上が充当されていれば "done" とする。
 */
function statusOf(recognized: number, settled: number): SettleStatus {
  if (settled <= 0) return "none";
  return settled >= Math.round(recognized) ? "done" : "partial";
}

/**
 * 3種のデータを1つの行型へ揃える。
 *
 * 返金は「完了扱いのステータスに到達したもの」だけを経費として合流させる。
 * 計上日は完了日時（refundedAt）。これは既存の売上レポートと同じ基準で、
 * ここを変えると過去の数字が動くため踏襲する。
 */
export function toLedgerRows(i: NormalizeInput): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const settledOf = (t: string, id: number): number => i.settled?.get(`${t}:${id}`) ?? 0;

  for (const p of i.payments) {
    const paid = p.paidAt ? p.paidAt.slice(0, 10) : "";
    const settled = settledOf("payment", p.id);
    rows.push({
      uid: `sales:${p.id}`, kind: "sales", sourceId: p.id,
      accrualDate: p.accrualDate || paid,
      paidDate: paid,
      expectedDate: p.expectedDate || "",
      partner: p.customerName || p.customerEmail || "（氏名なし）",
      category: nameOfMaster(i.types, p.typeId),
      categoryKey: p.typeId != null ? `t${p.typeId}` : "",
      siteName: nameOfMaster(i.sites, p.siteId),
      siteId: p.siteId,
      salesAmount: p.amount || 0,
      expenseAmount: 0,
      feeAmount: p.feeAmount || 0,
      netAmount: p.recognizedAmount || 0,
      settle: statusOf(p.recognizedAmount || 0, settled),
      settledAmount: settled,
      note: p.note || "",
    });
  }

  for (const e of i.expenses) {
    const paid = e.paidAt ? e.paidAt.slice(0, 10) : "";
    const settled = settledOf("expense", e.id);
    rows.push({
      uid: `expense:${e.id}`, kind: "expense", sourceId: e.id,
      accrualDate: e.accrualDate || paid,
      paidDate: paid,
      expectedDate: e.expectedDate || "",
      partner: e.vendorName || "（支払先なし）",
      category: nameOfCategory(i.categories, e.categoryId),
      categoryKey: e.categoryId != null ? `c${e.categoryId}` : "",
      siteName: nameOfMaster(i.sites, e.siteId),
      siteId: e.siteId,
      salesAmount: 0,
      expenseAmount: e.amount || 0,
      feeAmount: e.feeAmount || 0,
      netAmount: -(e.recognizedAmount || 0),
      settle: statusOf(e.recognizedAmount || 0, settled),
      settledAmount: settled,
      note: e.note || "",
    });
  }

  for (const r of i.refunds) {
    // 完了扱いに到達していない返金は、まだ経費ではない
    if (r.statusId == null || !i.refundDoneIds.has(r.statusId)) continue;
    const done = r.refundedAt ? r.refundedAt.slice(0, 10) : "";
    if (!done) continue;   // 完了だが日付が無い行は計上月を決められないので除外
    rows.push({
      uid: `refund:${r.id}`, kind: "refund", sourceId: r.id,
      accrualDate: done,
      paidDate: done,
      expectedDate: done,
      partner: r.customerName || r.customerEmail || "（氏名なし）",
      category: "返金",
      categoryKey: "refund",
      siteName: "—",
      siteId: null,
      salesAmount: 0,
      expenseAmount: r.refundAmount || 0,
      feeAmount: 0,
      netAmount: -(r.refundAmount || 0),
      // 返金は決済代行側で実行済みのため、入出金の記録を待たず完了として扱う
      settle: "done",
      settledAmount: r.refundAmount || 0,
      note: r.reason || r.note || "",
    });
  }

  return rows;
}

// ── 抽出 ─────────────────────────────────────────────────────
export function applyFilter(rows: LedgerRow[], f: LedgerFilter, today = todayIso()): LedgerRow[] {
  const { from, to } = resolvePeriod(f, today);
  const kw = f.keyword.trim().toLowerCase();
  const kinds = new Set(f.kinds);

  return rows.filter((r) => {
    if (!kinds.has(r.kind)) return false;

    const d = baseDateOf(r, f.base);
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;

    if (f.settle !== "all") {
      if (f.settle === "overdue") {
        // 予定日を過ぎているのに入出金が終わっていない（滞留）
        if (r.settle === "done") return false;
        if (!r.expectedDate || r.expectedDate >= today) return false;
      } else if (f.settle === "unsettled" && r.settle !== "none") return false;
      else if (f.settle === "partial" && r.settle !== "partial") return false;
      else if (f.settle === "done" && r.settle !== "done") return false;
    }

    if (f.categoryKeys.length && !f.categoryKeys.includes(r.categoryKey)) return false;
    if (f.siteIds.length && (r.siteId == null || !f.siteIds.includes(r.siteId))) return false;

    const amt = Math.abs(r.netAmount);
    if (f.minAmount != null && amt < f.minAmount) return false;
    if (f.maxAmount != null && amt > f.maxAmount) return false;

    if (kw && ![r.partner, r.category, r.siteName, r.note].some((s) => s.toLowerCase().includes(kw))) return false;

    return true;
  });
}

/** 並べ替え。既定は基準日の新しい順（同日は金額の大きい順） */
export type SortKey = "date" | "amount";
export function sortRows(rows: LedgerRow[], key: SortKey, base: DateBase): LedgerRow[] {
  const out = [...rows];
  if (key === "amount") {
    out.sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount));
  } else {
    out.sort((a, b) => {
      const da = baseDateOf(a, base), db = baseDateOf(b, base);
      if (da !== db) return da < db ? 1 : -1;
      return Math.abs(b.netAmount) - Math.abs(a.netAmount);
    });
  }
  return out;
}

// ── 集計 ─────────────────────────────────────────────────────
export interface LedgerTotals {
  count: number;
  /** 売上の計上額合計（正） */
  salesNet: number;
  /** 経費＋返金＋調整の計上額合計（正の値で返す。表示側で − を付ける） */
  expenseNet: number;
  /** 差引＝salesNet − expenseNet */
  balance: number;
  salesGross: number;
  expenseGross: number;
  fee: number;
}

export function totalize(rows: LedgerRow[]): LedgerTotals {
  let salesNet = 0, expenseNet = 0, salesGross = 0, expenseGross = 0, fee = 0;
  for (const r of rows) {
    if (r.netAmount >= 0) salesNet += r.netAmount;
    else expenseNet += -r.netAmount;
    salesGross += r.salesAmount;
    expenseGross += r.expenseAmount;
    fee += r.feeAmount;
  }
  return { count: rows.length, salesNet, expenseNet, balance: salesNet - expenseNet, salesGross, expenseGross, fee };
}

/** 月次の推移（基準日でグループ化）。キーは "YYYY-MM" */
export function byMonth(rows: LedgerRow[], base: DateBase): { month: string; totals: LedgerTotals }[] {
  const map = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const d = baseDateOf(r, base);
    if (!d) continue;
    const key = d.slice(0, 7);
    const arr = map.get(key);
    if (arr) arr.push(r); else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, rs]) => ({ month, totals: totalize(rs) }));
}

// ── CSV ──────────────────────────────────────────────────────
/** Excel が UTF-8 と判別できるよう BOM を付ける */
const BOM = "﻿";
const csvCell = (v: string | number): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: LedgerRow[]): string {
  const head = [
    "計上日", "決済支払日", "入出金予定日", "区分", "取引先・顧客", "科目・商品種別",
    "サイト", "売上金額", "経費金額", "手数料", "計上金額", "消込状況", "消込済額", "備考",
  ];
  const body = rows.map((r) => [
    r.accrualDate, r.paidDate, r.expectedDate, KIND_LABEL[r.kind], r.partner, r.category,
    r.siteName,
    r.salesAmount || "", r.expenseAmount || "", r.feeAmount || "", r.netAmount,
    SETTLE_LABEL[r.settle], r.settledAmount || "", r.note,
  ].map(csvCell).join(","));
  return BOM + [head.join(","), ...body].join("\r\n");
}

/** ブラウザでCSVを保存する（画面から呼ぶ） */
export function downloadCsv(rows: LedgerRow[], filename: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── URL クエリ ───────────────────────────────────────────────
//   抽出条件をURLに載せる。ブラウザの戻る/進むが効き、URL共有＝条件共有になる。
export function filterToQuery(f: LedgerFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (f.base !== DEFAULT_FILTER.base) q.set("base", f.base);
  if (f.period !== DEFAULT_FILTER.period) q.set("period", f.period);
  if (f.period === "custom") { if (f.from) q.set("from", f.from); if (f.to) q.set("to", f.to); }
  if (f.kinds.length !== ALL_KINDS.length) q.set("kinds", f.kinds.join(","));
  if (f.categoryKeys.length) q.set("cat", f.categoryKeys.join(","));
  if (f.siteIds.length) q.set("site", f.siteIds.join(","));
  if (f.settle !== "all") q.set("settle", f.settle);
  if (f.keyword.trim()) q.set("q", f.keyword.trim());
  if (f.minAmount != null) q.set("min", String(f.minAmount));
  if (f.maxAmount != null) q.set("max", String(f.maxAmount));
  return q;
}

const numList = (s: string | null): number[] =>
  (s ?? "").split(",").map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);

export function queryToFilter(q: URLSearchParams): LedgerFilter {
  const base = q.get("base");
  const period = q.get("period");
  const settle = q.get("settle");
  const kinds = (q.get("kinds") ?? "").split(",").filter((k): k is LedgerKind =>
    (ALL_KINDS as string[]).includes(k));
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    base: base === "paid" || base === "expected" ? base : "accrual",
    period: period === "lastMonth" || period === "thisQuarter" || period === "thisYear"
      || period === "last12m" || period === "custom" ? period : "thisMonth",
    from: q.get("from") ?? "",
    to: q.get("to") ?? "",
    kinds: kinds.length ? kinds : [...ALL_KINDS],
    categoryKeys: (q.get("cat") ?? "").split(",").filter(Boolean),
    siteIds: numList(q.get("site")),
    settle: settle === "unsettled" || settle === "partial" || settle === "done" || settle === "overdue" ? settle : "all",
    keyword: q.get("q") ?? "",
    minAmount: num("min"),
    maxAmount: num("max"),
  };
}

/** 抽出条件を1行で説明する（画面上部のチップ用） */
export function describeFilter(f: LedgerFilter, today = todayIso()): string[] {
  const { from, to } = resolvePeriod(f, today);
  const baseLabel = f.base === "paid" ? "決済支払日" : f.base === "expected" ? "入出金予定日" : "計上日";
  const out = [`${baseLabel}：${from || "—"} 〜 ${to || "—"}`];
  if (f.kinds.length !== ALL_KINDS.length) out.push(`区分：${f.kinds.map((k) => KIND_LABEL[k]).join("・")}`);
  if (f.settle !== "all") {
    const m: Record<string, string> = { unsettled: "未入出金のみ", partial: "一部のみ", done: "完了のみ", overdue: "予定日超過" };
    out.push(m[f.settle] ?? "");
  }
  if (f.categoryKeys.length) out.push(`科目：${f.categoryKeys.length}件を指定`);
  if (f.siteIds.length) out.push(`サイト：${f.siteIds.length}件を指定`);
  if (f.keyword.trim()) out.push(`検索：${f.keyword.trim()}`);
  if (f.minAmount != null || f.maxAmount != null) {
    out.push(`金額：${f.minAmount ?? ""}〜${f.maxAmount ?? ""}`);
  }
  return out.filter(Boolean);
}
