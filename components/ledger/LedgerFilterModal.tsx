"use client";
// ============================================================
// 抽出条件モーダル（売上経費／入金出金 一覧）
//
//   ・「期間の基準日」を切り替えられるのが要点。同じデータを
//     月次PL視点（計上日）でも資金繰り視点（入出金予定日）でも見られる。
//   ・期間は相対指定（当月・先月…）で保存する。開くたびに今日基準で解決されるので、
//     翌月になっても「当月」のまま最新を見られる。
//   ・確定するまで親には反映しない（下書きを内部 state に持つ）。
// ============================================================
import { useEffect, useState } from "react";
import { Sheet } from "../common/Sheet";
import { MultiSelect } from "../common/MultiSelect";
import {
  ALL_KINDS, DEFAULT_FILTER, KIND_LABEL, resolvePeriod,
  type DateBase, type LedgerFilter, type LedgerKind, type PeriodPreset,
} from "../../lib/ledger";
import type { ExpenseCategory, PaymentMaster, SelectOption } from "../../lib/models";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

const BASES: { v: DateBase; label: string; hint: string }[] = [
  { v: "accrual",  label: "計上日",       hint: "月次PL・利益分配を見るならこれ" },
  { v: "paid",     label: "決済日・支払日", hint: "実際に取引が起きた日で見る" },
  { v: "expected", label: "入出金予定日",  hint: "資金繰りの予測を見るならこれ" },
];
const PERIODS: { v: PeriodPreset; label: string }[] = [
  { v: "thisMonth", label: "当月" }, { v: "lastMonth", label: "先月" },
  { v: "thisQuarter", label: "今四半期" }, { v: "thisYear", label: "今年" },
  { v: "last12m", label: "過去12ヶ月" }, { v: "custom", label: "期間を指定" },
];
const SETTLES: { v: LedgerFilter["settle"]; label: string }[] = [
  { v: "all", label: "すべて" },
  { v: "unsettled", label: "未入金・未払のみ" },
  { v: "partial", label: "一部のみ" },
  { v: "done", label: "完了のみ" },
  { v: "overdue", label: "予定日超過（滞留）" },
];

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${on
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`;

export interface LedgerFilterModalProps {
  open: boolean;
  value: LedgerFilter;
  categories: ExpenseCategory[];
  types: PaymentMaster[];
  sites: PaymentMaster[];
  onClose: () => void;
  onApply: (f: LedgerFilter) => void;
}

export function LedgerFilterModal({
  open, value, categories, types, sites, onClose, onApply,
}: LedgerFilterModalProps) {
  const [d, setD] = useState<LedgerFilter>(value);

  // 開くたびに現在の条件を読み込み直す（前回の下書きを持ち越さない）
  useEffect(() => { if (open) setD(value); }, [open, value]);

  const set = (patch: Partial<LedgerFilter>) => setD({ ...d, ...patch });

  const toggleKind = (k: LedgerKind) => {
    const has = d.kinds.includes(k);
    // 最後の1つは外させない（全部OFFだと必ず0件になり、原因が分かりにくい）
    if (has && d.kinds.length === 1) return;
    set({ kinds: has ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] });
  };

  // 売上（商品種別）と経費（経費科目）は別マスタなので、接頭辞で分けて1つの選択肢にまとめる
  const catOptions: SelectOption[] = [
    ...types.filter((t) => !t.isDeleted).map((t) => ({ value: `t${t.id}`, label: `売上：${t.name}` })),
    ...categories.filter((c) => !c.isDeleted).map((c) => ({ value: `c${c.id}`, label: `経費：${c.name}` })),
    { value: "refund", label: "経費：返金" },
  ];
  const siteOptions: SelectOption[] = sites.filter((s) => !s.isDeleted)
    .map((s) => ({ value: String(s.id), label: s.name }));

  const { from, to } = resolvePeriod(d);

  const num = (v: string): number | null => {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="抽出条件"
      maxWidth={760}
      footer={
        <div className="flex items-center gap-2 w-full">
          <button onClick={() => setD({ ...DEFAULT_FILTER })}
            className="text-sm py-2 px-4 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            条件をクリア
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            キャンセル
          </button>
          <button onClick={() => { onApply(d); onClose(); }}
            className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700">
            この条件で抽出
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 期間の基準日 */}
        <div>
          <label className="text-xs font-bold text-gray-500 block mb-1.5">期間の基準日</label>
          <div className="flex flex-wrap gap-1.5">
            {BASES.map((b) => (
              <button key={b.v} type="button" className={chip(d.base === b.v)} onClick={() => set({ base: b.v })}>
                {b.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">{BASES.find((b) => b.v === d.base)?.hint}</p>
        </div>

        {/* 期間 */}
        <div>
          <label className="text-xs font-bold text-gray-500 block mb-1.5">期間</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PERIODS.map((p) => (
              <button key={p.v} type="button" className={chip(d.period === p.v)} onClick={() => set({ period: p.v })}>
                {p.label}
              </button>
            ))}
          </div>
          {d.period === "custom" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <input type="date" className={input} value={d.from} onChange={(e) => set({ from: e.target.value })} />
              <input type="date" className={input} value={d.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
          ) : (
            <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
              いまの「{PERIODS.find((p) => p.v === d.period)?.label}」＝ <b>{from}</b> 〜 <b>{to}</b>
              <span className="text-emerald-600">（相対指定なので、次に開いたときも最新の期間になります）</span>
            </p>
          )}
        </div>

        {/* 区分 */}
        <div>
          <label className="text-xs font-bold text-gray-500 block mb-1.5">区分</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_KINDS.map((k) => (
              <button key={k} type="button" className={chip(d.kinds.includes(k))} onClick={() => toggleKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {/* 科目・サイト */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <MultiSelect
            label="科目・商品種別"
            options={catOptions}
            selected={d.categoryKeys}
            onChange={(next) => set({ categoryKeys: next })}
            searchable
          />
          <MultiSelect
            label="決済・支払サイト"
            options={siteOptions}
            selected={d.siteIds.map(String)}
            onChange={(next) => set({ siteIds: next.map(Number).filter((n) => Number.isFinite(n)) })}
          />
        </div>

        {/* 入出金状況 */}
        <div>
          <label className="text-xs font-bold text-gray-500 block mb-1.5">入出金の状況</label>
          <select className={`${input} bg-white`} value={d.settle}
            onChange={(e) => set({ settle: e.target.value as LedgerFilter["settle"] })}>
            {SETTLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">
            「入金出金」タブで消し込んだ結果が反映されます。まだ入出金を登録していない間は、
            すべて「未入金・未払」として出ます。
          </p>
        </div>

        {/* 検索・金額 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div><label className="text-xs font-bold text-gray-500 block mb-1">取引先・顧客・備考</label>
            <input className={input} value={d.keyword} onChange={(e) => set({ keyword: e.target.value })} placeholder="部分一致" /></div>
          <div><label className="text-xs font-bold text-gray-500 block mb-1">計上金額（下限）</label>
            <input type="number" inputMode="numeric" className={input} value={d.minAmount ?? ""}
              onChange={(e) => set({ minAmount: num(e.target.value) })} placeholder="—" /></div>
          <div><label className="text-xs font-bold text-gray-500 block mb-1">計上金額（上限）</label>
            <input type="number" inputMode="numeric" className={input} value={d.maxAmount ?? ""}
              onChange={(e) => set({ maxAmount: num(e.target.value) })} placeholder="—" /></div>
        </div>
      </div>
    </Sheet>
  );
}
