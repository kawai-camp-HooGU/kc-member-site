"use client";
// ============================================================
// 売上経費／入金出金 一覧（独立ルート /ops/ledger）
//
//   売上・経費・返金を1つの表で一気通貫に見る画面。
//   タブで「売上経費」と「入金出金」を切り替える。
//
//   ＜2つのタブは行の粒度が違う＞
//     売上経費 … 明細1件＝1行（計上額を持つ。月次PLの数字はここ）
//     入金出金 … 着金・送金1件＝1行（通帳の1行。バッチ）
//   同じ列構成を使い回さないこと。振込手数料などの差額は入金出金側に1行で吸収し、
//   売上経費の明細には按分しない。
//
//   ＜要点＞
//   ・抽出条件はURLクエリに載せる。戻る/進むが効き、URL共有＝条件共有になる。
//   ・既定は「計上日 × 当月」。相対指定なので翌月も最新の当月が出る。
//   ・売上金額と経費金額はカラムを分け、「計上金額」で符号付きに統一する。
//   ・合計行は抽出条件に連動して再計算される（tfoot に固定）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchPayments, fetchMasterOptions, formatYen } from "../../lib/payments";
import { fetchExpenses, fetchExpenseCategories } from "../../lib/expenses";
import { fetchRefunds, fetchRefundMasterOptions, doneStatusIds } from "../../lib/refunds";
import { RefundLinkModal } from "./RefundLinkModal";
import type { Refund } from "../../lib/models";
import {
  DEFAULT_FILTER, KIND_LABEL, SETTLE_LABEL, applyFilter, describeFilter, downloadCsv,
  filterToQuery, queryToFilter, resolvePeriod, sortRows, toLedgerRows, totalize, todayIso,
  type LedgerFilter, type LedgerKind, type LedgerRow, type SortKey,
} from "../../lib/ledger";
import {
  cashAvailable, fetchCashEntries, newCashEntry, settlementMap, sumAdjustments, sumAllocations,
} from "../../lib/cash";
import type { CashEntry, Expense, ExpenseCategory, Payment, PaymentMaster } from "../../lib/models";
import { LedgerFilterModal } from "./LedgerFilterModal";
import { CashEntryModal } from "./CashEntryModal";
import { useMaster } from "../../hooks/useMaster";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

type Tab = "pl" | "cash";

const kindPill: Record<LedgerKind, string> = {
  sales:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-red-50 text-red-700 border-red-200",
  refund:  "bg-blue-50 text-blue-700 border-blue-200",
  adjust:  "bg-gray-100 text-gray-600 border-gray-200",
};

const settlePill: Record<string, string> = {
  none:    "bg-gray-100 text-gray-500 border-gray-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  done:    "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/** 符号付きの金額表示。売上＝黒／経費・返金＝赤 */
function SignedAmount({ v }: { v: number }) {
  if (v === 0) return <span className="text-gray-300">—</span>;
  const plus = v > 0;
  return (
    <span className={`font-bold tabular-nums ${plus ? "text-emerald-700" : "text-red-700"}`}>
      {plus ? "+" : "−"}{formatYen(Math.abs(v)).replace("¥", "¥")}
    </span>
  );
}

export function LedgerView() {
  const router = useRouter();
  const { can } = useMaster();
  const canCash = can("cash_manage");
  const canExport = can("ledger_export");

  const [tab, setTab] = useState<Tab>("pl");
  const [filter, setFilter] = useState<LedgerFilter>(DEFAULT_FILTER);
  const [sort, setSort] = useState<SortKey>("date");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [types, setTypes] = useState<PaymentMaster[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);

  // 入金出金タブ用（消込の相手を組み立てるため生データを保持する）
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [cashEdit, setCashEdit] = useState<CashEntry | null>(null);
  /** 入出金テーブルが未作成（マイグレーション未適用）か */
  const [cashUnavailable, setCashUnavailable] = useState(false);

  // 返金の生データ。一覧の返金行から会員詳細を開く／未照合を紐付けるのに使う（REQ-036）
  const [refundRows, setRefundRows] = useState<Refund[]>([]);
  const [linkTarget, setLinkTarget] = useState<Refund | null>(null);

  // ── URL から条件を復元（初回のみ）──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") === "cash") setTab("cash");
    setFilter(queryToFilter(q));
  }, []);

  // ── データ取得 ──
  //   返金・経費・入出金は未導入／権限なしでも一覧を壊さない（それぞれ握りつぶす）。
  const load = useCallback(async () => {
    try {
      const [ps, m] = await Promise.all([fetchPayments(), fetchMasterOptions()]);
      setTypes(m.types); setSites(m.sites); setPayments(ps);

      const [exs, cs, ces] = await Promise.all([
        fetchExpenses().catch(() => [] as Expense[]),
        fetchExpenseCategories().catch(() => [] as ExpenseCategory[]),
        fetchCashEntries().catch(() => [] as CashEntry[]),
      ]);
      setCats(cs); setExpenses(exs); setEntries(ces);
      setCashUnavailable(cashAvailable() === false);

      let refunds: Awaited<ReturnType<typeof fetchRefunds>> = [];
      let doneIds: ReadonlySet<number> = new Set<number>();
      try {
        const [rs, ropts] = await Promise.all([fetchRefunds(), fetchRefundMasterOptions()]);
        refunds = rs;
        setRefundRows(rs);
        doneIds = doneStatusIds(ropts.refund_status);
      } catch { /* 返金機能が未導入・権限なしでも一覧は出す */ }

      setRows(toLedgerRows({
        payments: ps, expenses: exs, refunds,
        refundDoneIds: doneIds, types: m.types, sites: m.sites, categories: cs,
        settled: settlementMap(ces),
      }));
    } catch (e) {
      console.error("一覧の読込エラー:", e);
    }
  }, []);

  useEffect(() => { (async () => { await load(); setLoading(false); })(); }, [load]);

  /**
   * 返金行から編集へ渡す（REQ-036・確認事項2a）。
   *   会員に紐付いていれば会員詳細（返金・解約タブ）を別窓で開く。
   *   紐付いていない返金はどの会員の画面にも出ないので、まず会員を結び付ける。
   */
  const openRefund = (refundId: number) => {
    const r = refundRows.find((x) => x.id === refundId);
    if (!r) return;
    if (r.memberId != null) { window.open(`/ops/members/${r.memberId}?tab=refund`, "_blank", "noopener"); return; }
    setLinkTarget(r);
  };

  // ── 条件をURLへ反映 ──
  const pushUrl = useCallback((f: LedgerFilter, t: Tab) => {
    if (typeof window === "undefined") return;
    const q = filterToQuery(f);
    if (t === "cash") q.set("tab", "cash");
    const qs = q.toString();
    router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false });
  }, [router]);

  const applyFilterAndUrl = (f: LedgerFilter) => { setFilter(f); pushUrl(f, tab); };
  const switchTab = (t: Tab) => { setTab(t); pushUrl(filter, t); };

  const today = todayIso();
  const shown = useMemo(
    () => sortRows(applyFilter(rows, filter, today), sort, filter.base),
    [rows, filter, sort, today],
  );
  const totals = useMemo(() => totalize(shown), [shown]);
  const chips = useMemo(() => describeFilter(filter, today), [filter, today]);
  const { from, to } = resolvePeriod(filter, today);

  const onCsv = () => downloadCsv(shown, `売上経費一覧_${from}_${to}.csv`);

  // ── 入金出金タブの集計 ────────────────────────────────────
  //   期首残高＝期間より前の（入金 − 出金）の累計。
  //   ここに入っている入出金だけの残高であり、通帳の実残高とは一致しない。
  const cash = useMemo(() => {
    const signed = (e: CashEntry) => (e.direction === "in" ? 1 : -1) * (Math.round(e.amount) || 0);
    let opening = 0, inSum = 0, outSum = 0;
    const inPeriod: CashEntry[] = [];
    for (const e of entries) {
      const d = e.entryDate;
      if (!d) continue;
      if (from && d < from) { opening += signed(e); continue; }
      if (to && d > to) continue;
      inPeriod.push(e);
      if (e.direction === "in") inSum += Math.round(e.amount) || 0;
      else outSum += Math.round(e.amount) || 0;
    }
    inPeriod.sort((a, b) => (a.entryDate !== b.entryDate ? (a.entryDate < b.entryDate ? 1 : -1) : b.id - a.id));
    return { opening, inSum, outSum, closing: opening + inSum - outSum, list: inPeriod };
  }, [entries, from, to]);

  const siteName = (id: number | null) => (id == null ? "—" : sites.find((s) => s.id === id)?.name ?? `不明(#${id})`);

  const openCash = (e: CashEntry) => setCashEdit({ ...e, allocations: [...e.allocations] });

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">
          {tab === "cash" ? "入金出金" : "売上経費一覧"}
        </h1>
        <span className="text-xs text-gray-400">{from} 〜 {to}</span>
        <div className="flex-1" />
        {tab === "pl" && canExport && (
          <button onClick={onCsv} disabled={shown.length === 0}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            CSV書き出し
          </button>
        )}
        {tab === "cash" && canCash && (
          <>
            <button onClick={() => setCashEdit(newCashEntry("out"))} disabled={cashUnavailable}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
              ＋ 出金
            </button>
            <button onClick={() => setCashEdit(newCashEntry("in"))} disabled={cashUnavailable}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">
              ＋ 入金
            </button>
          </>
        )}
        <button onClick={() => setModalOpen(true)}
          className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
          抽出条件
        </button>
      </div>

      {/* タブ */}
      <div className="flex items-end gap-1 border-b border-gray-200">
        <button onClick={() => switchTab("pl")}
          className={`px-4 py-2 text-sm font-bold rounded-t-lg border border-b-0 -mb-px ${tab === "pl"
            ? "border-gray-200 bg-white text-red-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
          売上経費
        </button>
        <button onClick={() => switchTab("cash")}
          className={`px-4 py-2 text-sm font-bold rounded-t-lg border border-b-0 -mb-px ${tab === "cash"
            ? "border-gray-200 bg-white text-red-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
          入金出金
        </button>
      </div>

      {tab === "cash" ? (
        <>
          {cashUnavailable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[12.5px] font-bold text-amber-800">入出金テーブルがまだありません</div>
              <p className="text-[11.5px] text-amber-700 mt-1">
                この画面を使うには <code className="font-mono">supabase/migration_add_pl_ledger.sql</code> の適用が必要です。
                適用すると、着金・送金の登録と消込が使えるようになります。
              </p>
            </div>
          )}

          {/* 残高の流れ（期首＋入金−出金＝期末）*/}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">期首残高</div><div className="text-xl font-bold text-gray-800 tabular-nums">{cash.opening < 0 ? "− " : ""}{formatYen(Math.abs(cash.opening))}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">入金</div><div className="text-xl font-bold text-emerald-700 tabular-nums">＋ {formatYen(cash.inSum)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">出金</div><div className="text-xl font-bold text-red-600 tabular-nums">− {formatYen(cash.outSum)}</div></div>
            <div className="bg-gray-800 rounded-xl px-4 py-3"><div className="text-[11px] text-gray-300">期末残高</div><div className="text-xl font-bold text-white tabular-nums">{cash.closing < 0 ? "− " : ""}{formatYen(Math.abs(cash.closing))}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">件数</div><div className="text-xl font-bold text-gray-800">{cash.list.length} 件</div></div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-1">
            ここに登録した入出金だけの残高です。通帳の実残高と一致させるには、口座の入出金をすべて登録する必要があります。
          </p>

          {/* 入出金の表（1件＝通帳の1行）*/}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {cash.list.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">
                {cashUnavailable
                  ? "マイグレーション適用後に利用できます。"
                  : <>この期間の入出金がありません。{canCash && "「＋ 入金」から通帳の1行を登録してください。"}</>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-gray-700 text-gray-100">
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">入出金日</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">区分</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">経路</th>
                      <th className="text-left font-bold px-3 py-2">口座・摘要</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">実入出金額</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">充当額</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">差額</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">消込</th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {cash.list.map((e) => {
                      const allocated = sumAllocations(e.allocations);
                      const adj = sumAdjustments(e.adjustments);
                      const isIn = e.direction === "in";
                      const unallocated = e.allocations.length === 0;
                      return (
                        <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">{e.entryDate || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${isIn
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-red-700 border-red-200"}`}>
                              {isIn ? "入金" : "出金"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{siteName(e.siteId)}</td>
                          <td className="px-3 py-2 max-w-[260px]">
                            <div className="text-gray-800 font-semibold truncate" title={e.description}>{e.description || "—"}</div>
                            <div className="text-[10.5px] text-gray-400 truncate">{e.accountName || "—"}</div>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <span className={`font-bold tabular-nums ${isIn ? "text-emerald-700" : "text-red-700"}`}>
                              {isIn ? "+" : "−"}{formatYen(e.amount)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {allocated ? formatYen(allocated) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {adj === 0
                              ? <span className="text-gray-300">—</span>
                              : <span className="text-amber-700 font-semibold">{adj > 0 ? "−" : "＋"}{formatYen(Math.abs(adj))}</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${unallocated ? settlePill.none : settlePill.done}`}>
                              {unallocated ? "未消込" : `${e.allocations.length}件`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => openCash(e)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                              {canCash ? "編集" : "詳細"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-700 bg-gray-50 font-bold">
                      <td className="px-3 py-2.5 text-gray-700" colSpan={4}>合計（{cash.list.length}件）</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                        {cash.inSum - cash.outSum < 0 ? "− " : "+ "}{formatYen(Math.abs(cash.inSum - cash.outSum))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                        {formatYen(cash.list.reduce((s, e) => s + sumAllocations(e.allocations), 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                        {formatYen(Math.abs(cash.list.reduce((s, e) => s + sumAdjustments(e.adjustments), 0)))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11.5px] text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 leading-relaxed">
            <b>差額</b>は振込手数料などです。<b>明細には按分せず</b>、入出金1件につき1行で吸収します。
            消込をしても売上・経費の計上額は変わりません。
          </p>
        </>
      ) : (
        <>
          {/* 条件チップ */}
          <div className="flex items-center gap-2 flex-wrap">
            {chips.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 rounded-full px-2.5 py-1">
                {c}
              </span>
            ))}
            <div className="flex-1" />
            <select className={`${input} w-auto py-1.5 text-[12px] bg-white`} value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="date">日付順（新しい順）</option>
              <option value="amount">金額順（大きい順）</option>
            </select>
          </div>

          {/* サマリ */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">売上 計上額</div><div className="text-xl font-bold text-emerald-700">{formatYen(totals.salesNet)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">経費 計上額</div><div className="text-xl font-bold text-red-600">− {formatYen(totals.expenseNet)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">差引</div><div className={`text-xl font-bold ${totals.balance >= 0 ? "text-gray-800" : "text-red-600"}`}>{totals.balance < 0 ? "− " : ""}{formatYen(Math.abs(totals.balance))}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">決済手数料</div><div className="text-xl font-bold text-gray-800">{formatYen(totals.fee)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">件数</div><div className="text-xl font-bold text-gray-800">{totals.count} 件</div></div>
          </div>

          {/* 表 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {shown.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">
                該当する取引がありません。<button onClick={() => setModalOpen(true)} className="text-red-500 hover:text-red-700 underline ml-1">抽出条件</button>を見直してください。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-gray-700 text-gray-100">
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">計上日</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">区分</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">予定日</th>
                      <th className="text-left font-bold px-3 py-2">取引先・顧客</th>
                      <th className="text-left font-bold px-3 py-2">科目・商品種別</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">サイト</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">売上金額</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">経費金額</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">手数料</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">計上金額</th>
                      <th className="text-left font-bold px-3 py-2 whitespace-nowrap">消込</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const overdue = r.settle !== "done" && !!r.expectedDate && r.expectedDate < today;
                      return (
                        <tr key={r.uid} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.accrualDate || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${kindPill[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                          </td>
                          <td className={`px-3 py-2 whitespace-nowrap ${overdue ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                            {r.expectedDate || "—"}{overdue && <span className="ml-1 text-[10px]">超過</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-800 font-semibold max-w-[220px] truncate" title={r.partner}>
                            {r.kind === "refund" && r.refundId != null ? (
                              <button onClick={() => openRefund(r.refundId as number)}
                                className="text-left max-w-full truncate text-red-700 hover:underline">
                                {r.partner} <span className="text-[10px] text-gray-400">編集 ↗</span>
                              </button>
                            ) : r.partner}
                          </td>
                          <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={r.category}>{r.category}</td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.siteName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.salesAmount ? formatYen(r.salesAmount) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.expenseAmount ? formatYen(r.expenseAmount) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-500">{r.feeAmount ? `−${formatYen(r.feeAmount)}` : <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap"><SignedAmount v={r.netAmount} /></td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${settlePill[r.settle]}`}
                              title={r.settledAmount ? `消込済 ${formatYen(r.settledAmount)}` : ""}>
                              {SETTLE_LABEL[r.settle]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-700 bg-gray-50 font-bold">
                      <td className="px-3 py-2.5 text-gray-700" colSpan={6}>合計（{totals.count}件）</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">{formatYen(totals.salesGross)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">{formatYen(totals.expenseGross)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-red-600">−{formatYen(totals.fee)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap"><SignedAmount v={totals.balance} /></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <LedgerFilterModal
        open={modalOpen}
        value={filter}
        categories={cats}
        types={types}
        sites={sites}
        onClose={() => setModalOpen(false)}
        onApply={applyFilterAndUrl}
      />

      <CashEntryModal
        open={!!cashEdit}
        value={cashEdit}
        sites={sites}
        payments={payments}
        expenses={expenses}
        entries={entries}
        onClose={() => setCashEdit(null)}
        onSaved={load}
      />

      {linkTarget && (
        <RefundLinkModal
          refund={linkTarget}
          onClose={() => setLinkTarget(null)}
          onLinked={(memberId) => {
            setLinkTarget(null);
            void load();
            window.open(`/ops/members/${memberId}?tab=refund`, "_blank", "noopener");
          }}
        />
      )}
    </div>
  );
}
