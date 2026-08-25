"use client";
// ============================================================
// 決済マスタ編集（設定 ＞ 決済マスタ）
//
//   商品種別 / 決済サイト / 決済方法 をタブで切替。自動採番（No.）。
//   共通項目：名称・備考。商品種別のみ：売上計上フラグ・決済必要金額。
//   削除は「非表示（削除フラグ・推奨）」と「完全削除（物理・警告）」の2択。
//   完全削除は payment_admin 権限のみ。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  fetchMasters, saveMaster, hideMaster, hardDeleteMaster, formatYen,
  MASTER_LABEL, ledgerColumnsKnown, type MasterKind,
} from "../../lib/payments";
import {
  DEFAULT_SITE_CONFIG, LAST_DAY, describeCycle, describeFee,
  fmtDateWithDow, previewExpected,
  type CycleType, type FeeRounding, type HolidayShift, type PaymentSiteConfig,
} from "../../lib/paymentSites";
import {
  fetchExpenseCategories, saveExpenseCategory, hideExpenseCategory, expensesAvailable,
} from "../../lib/expenses";
import type { ExpenseCategory, PaymentMaster } from "../../lib/models";
import { useMaster } from "../../hooks/useMaster";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

/** 決済3マスタ ＋ 経費科目。経費科目だけ別テーブル（expense_categories）を見る */
type TabKind = MasterKind | "category";
const KINDS: TabKind[] = ["type", "site", "method", "category"];
const TAB_LABEL: Record<TabKind, string> = { ...MASTER_LABEL, category: "経費科目" };

/** ExpenseCategory を一覧・編集UIで使う PaymentMaster 形へ寄せる */
const toMasterRow = (c: ExpenseCategory): PaymentMaster => ({
  id: c.id, name: c.name, note: c.note, sortOrder: c.sortOrder, isDeleted: c.isDeleted, isCost: c.isCost,
});
/** 逆変換（保存時） */
const toCategoryRow = (m: PaymentMaster): ExpenseCategory => ({
  id: m.id, name: m.name, note: m.note, sortOrder: m.sortOrder, isDeleted: m.isDeleted, isCost: !!m.isCost,
});

// ── 入金サイクル設定の選択肢 ────────────────────────────────
const CYCLES: { v: CycleType; label: string; hint: string }[] = [
  { v: "none",     label: "即時／自動計算なし", hint: "入金予定日は決済日と同じ日にします" },
  { v: "offset",   label: "決済からN日後",     hint: "Stripe・PayPal など。営業日で数えることもできます" },
  { v: "closing",  label: "締め日方式",        hint: "「末日締め 翌月末日払い」のような取引条件" },
  { v: "periodic", label: "毎月◯日",          hint: "決済日以降、最初に到来する支払日" },
];
const SHIFTS: { v: HolidayShift; label: string }[] = [
  { v: "none",   label: "補正しない" },
  { v: "before", label: "前営業日に繰上" },
  { v: "after",  label: "翌営業日に繰下" },
];
const ROUNDINGS: { v: FeeRounding; label: string }[] = [
  { v: "floor", label: "切捨" },
  { v: "round", label: "四捨五入" },
  { v: "ceil",  label: "切上" },
];
/** 1〜31日 ＋ 末日 の選択肢 */
const DAY_OPTIONS = [
  { v: LAST_DAY, label: "末日" },
  ...Array.from({ length: 31 }, (_, i) => ({ v: i + 1, label: `${i + 1}日` })),
];

/** 今日を "YYYY-MM-DD" で（プレビューの基準日。ローカル日付でよい） */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PaymentMasterView() {
  const { can } = useMaster();
  const confirm = useConfirm();
  const toast = useToast();
  const canHardDelete = can("payment_admin");

  const [kind, setKind] = useState<TabKind>("type");
  const [rows, setRows] = useState<PaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [edit, setEdit] = useState<PaymentMaster | null>(null);
  /** 経費科目テーブルが未作成（マイグレーション未適用）か */
  const [catUnavailable, setCatUnavailable] = useState(false);

  const reload = async (k: TabKind) => {
    try {
      if (k === "category") {
        const cs = await fetchExpenseCategories(true);
        setRows(cs.map(toMasterRow));
        setCatUnavailable(expensesAvailable() === false);
      } else {
        setRows(await fetchMasters(k, true));
      }
    } catch (e) { console.error("マスタ読込エラー:", e); }
  };
  useEffect(() => { setLoading(true); reload(kind).finally(() => setLoading(false)); setEdit(null); }, [kind]);

  const visibleRows = useMemo(() => showHidden ? rows : rows.filter((r) => !r.isDeleted), [rows, showHidden]);
  const isType = kind === "type";
  const isSite = kind === "site";
  const isCat  = kind === "category";
  /** 入金サイクル列がDBに無い（マイグレーション未適用）なら案内を出す */
  const cycleUnavailable = isSite && ledgerColumnsKnown().sites === false;
  /** 経費科目には物理削除を用意していない（誤操作の余地を作らない） */
  const allowHardDelete = canHardDelete && !isCat;

  const newMaster = (): PaymentMaster => ({
    id: 0, name: "", note: "", sortOrder: rows.length, isDeleted: false,
    salesFlag: isType ? true : undefined, requiredAmount: isType ? 0 : undefined,
    site: isSite ? { ...DEFAULT_SITE_CONFIG } : undefined,
    isCost: isCat ? false : undefined,
  });

  /** 編集中の決済サイト設定（未設定なら既定値で開く） */
  const cfg: PaymentSiteConfig = edit?.site ?? DEFAULT_SITE_CONFIG;
  const setCfg = (patch: Partial<PaymentSiteConfig>) => {
    if (!edit) return;
    setEdit({ ...edit, site: { ...cfg, ...patch } });
  };

  const doSave = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { alert(`${TAB_LABEL[kind]}名を入力してください`); return; }
    const res = isCat
      ? await saveExpenseCategory(toCategoryRow(edit))
      : await saveMaster(kind as MasterKind, edit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setEdit(null); await reload(kind);
    toast.success("保存しました");
  };
  const doHide = async () => {
    if (!edit?.id) return;
    if (isCat) await hideExpenseCategory(edit.id);
    else await hideMaster(kind as MasterKind, edit.id);
    setEdit(null); await reload(kind);
    toast.success("非表示にしました（参照は保持されます）");
  };
  const doRestore = async (m: PaymentMaster) => {
    if (isCat) await saveExpenseCategory(toCategoryRow({ ...m, isDeleted: false }));
    else await saveMaster(kind as MasterKind, { ...m, isDeleted: false });
    await reload(kind);
    toast.success("表示に戻しました");
  };
  const doHardDelete = async () => {
    if (!edit?.id) return;
    if (!allowHardDelete) { toast.error("完全削除の権限がありません（管理者に依頼してください）"); return; }
    const ok = await confirm({
      title: "完全に削除しますか？",
      message: `「${edit.name}」を物理削除します。この番号を参照している過去の決済は表示が「不明」になります。取り消せません。`,
      confirmLabel: "完全削除する", danger: true,
    });
    if (!ok) return;
    const r = await hardDeleteMaster(kind as MasterKind, edit.id);
    if (!r.ok) { toast.error(`削除に失敗しました：${r.error}`); return; }
    setEdit(null); await reload(kind);
    toast.success("完全に削除しました");
  };

  const seg = (on: boolean) =>
    `px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${on ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`;

  const detailOpen = !!edit;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">決済マスタ</h1>
        <span className="text-xs text-gray-400">商品種別・決済サイト・決済方法・経費科目を管理します（自動採番）。</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          {KINDS.map((k) => (
            <button key={k} type="button" className={seg(kind === k)} onClick={() => setKind(k)}>{TAB_LABEL[k]}</button>
          ))}
        </div>
        <button onClick={() => setShowHidden((v) => !v)} className={`px-3 py-2 rounded-lg border text-sm font-semibold ${showHidden ? "border-gray-300 bg-gray-50 text-gray-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>非表示も表示</button>
        <div className="flex-1" />
        <button onClick={() => setEdit(newMaster())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 追加</button>
      </div>

      {isCat && catUnavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[12.5px] font-bold text-amber-800">経費科目テーブルがまだありません</div>
          <p className="text-[11.5px] text-amber-700 mt-1">
            <code className="font-mono">supabase/migration_add_pl_ledger.sql</code> を適用すると、既定の科目（広告宣伝費・外注費 ほか）が入ります。
          </p>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p> : (
      <div className={detailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 items-start" : ""}>
        {/* 一覧 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {visibleRows.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">まだありません。「＋ 追加」から登録してください。</div>
            : visibleRows.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-gray-100" : ""} ${edit && edit.id === m.id && m.id !== 0 ? "bg-red-50" : ""} ${m.isDeleted ? "opacity-55" : ""}`}>
                <span className="w-8 shrink-0 text-[12px] font-mono text-gray-500">{m.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{m.name || "（無名）"}</div>
                  {m.note && <div className="text-[11px] text-gray-400 truncate">{m.note}</div>}
                </div>
                {isType && (
                  <>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${m.salesFlag ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.salesFlag ? "計上" : "非計上"}</span>
                    <span className="shrink-0 w-20 text-right text-[12.5px] font-bold text-gray-700 tabular-nums">{formatYen(m.requiredAmount ?? 0)}</span>
                  </>
                )}
                {isCat && (
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${m.isCost ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"}`}>{m.isCost ? "原価" : "販管費"}</span>
                )}
                {isSite && (
                  <>
                    <span className="shrink-0 text-[11px] text-gray-500 hidden sm:inline">{describeCycle(m.site)}</span>
                    <span className="shrink-0 w-24 text-right text-[11.5px] text-gray-600 tabular-nums">手数料 {describeFee(m.site)}</span>
                  </>
                )}
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${m.isDeleted ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-700"}`}>{m.isDeleted ? "非表示" : "表示"}</span>
                {m.isDeleted
                  ? <button onClick={() => doRestore(m)} className="shrink-0 text-xs text-gray-500 hover:text-gray-700 px-2 py-1">戻す</button>
                  : <button onClick={() => setEdit({ ...m })} className="shrink-0 text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>}
              </div>
            ))}
        </div>

        {/* 編集 */}
        {edit && (
        <div className="lg:sticky lg:top-4 self-start min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{edit.id ? `${TAB_LABEL[kind]}を編集` : `${TAB_LABEL[kind]}を追加`}</h2>
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {edit.id ? (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">No.（自動採番・変更不可）</label>
                  <input className={`${input} bg-gray-100 text-gray-600 font-mono`} value={edit.id} readOnly /></div>
              ) : null}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">{TAB_LABEL[kind]}名 <span className="text-red-500">*</span></label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>

              {isCat && (
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">区分</label>
                  <button type="button" onClick={() => setEdit({ ...edit, isCost: !edit.isCost })}
                    className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${edit.isCost ? "border-orange-300 bg-orange-50 text-orange-800" : "border-gray-200 bg-white text-gray-600"}`}>
                    <span>{edit.isCost ? "原価（売上に直接ひもづく費用）" : "販管費（それ以外）"}</span>
                    <span className={`relative w-10 h-[21px] rounded-full ${edit.isCost ? "bg-orange-500" : "bg-gray-300"}`}><span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.isCost ? "left-[21px]" : "left-0.5"}`} /></span>
                  </button>
                  <p className="text-[11px] text-gray-400 mt-1">将来の粗利計算で原価と販管費を分けるために使います。</p>
                </div>
              )}

              {isType && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">売上計上フラグ</label>
                    <button onClick={() => setEdit({ ...edit, salesFlag: !edit.salesFlag })} className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${edit.salesFlag ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-600"}`}>
                      <span>{edit.salesFlag ? "計上する" : "計上しない"}</span>
                      <span className={`relative w-10 h-[21px] rounded-full ${edit.salesFlag ? "bg-green-500" : "bg-gray-300"}`}><span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.salesFlag ? "left-[21px]" : "left-0.5"}`} /></span>
                    </button>
                    <p className="text-[11px] text-gray-400 mt-1">ONの種別のみ売上計上額の集計対象。</p></div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">決済必要金額（円）</label>
                    <input type="number" inputMode="numeric" className={input} value={edit.requiredAmount || ""} onChange={(e) => setEdit({ ...edit, requiredAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="0" />
                    <p className="text-[11px] text-gray-400 mt-1">売上計上金額の初期値の目安。</p></div>
                </div>
              )}

              {isSite && (
                <div className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-gray-700">入金サイクルと手数料</span>
                    <span className="text-[11px] text-gray-400">売上入力の「入金予定日」「決済手数料」を自動計算します</span>
                  </div>

                  {cycleUnavailable && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      この設定を保存するにはDBの追加列が必要です（マイグレーション未適用）。適用までは名称・備考のみ保存されます。
                    </p>
                  )}

                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">入金サイクル方式</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CYCLES.map((c) => (
                        <button key={c.v} type="button" onClick={() => setCfg({ cycleType: c.v })}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${cfg.cycleType === c.v ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">{CYCLES.find((c) => c.v === cfg.cycleType)?.hint}</p>
                  </div>

                  {cfg.cycleType === "offset" && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">日数</label>
                        <input type="number" inputMode="numeric" min={0} className={input} value={cfg.offsetDays || ""}
                          onChange={(e) => setCfg({ offsetDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="4" /></div>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">数え方</label>
                        <select className={`${input} bg-white`} value={cfg.dayType}
                          onChange={(e) => setCfg({ dayType: e.target.value === "business" ? "business" : "calendar" })}>
                          <option value="calendar">暦日</option>
                          <option value="business">営業日（土日祝を除く）</option>
                        </select></div>
                    </div>
                  )}

                  {cfg.cycleType === "closing" && (
                    <div className="grid grid-cols-3 gap-2.5">
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">締め日</label>
                        <select className={`${input} bg-white`} value={cfg.closingDay}
                          onChange={(e) => setCfg({ closingDay: Number(e.target.value) })}>
                          {DAY_OPTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                        </select></div>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">支払月</label>
                        <select className={`${input} bg-white`} value={cfg.monthOffset}
                          onChange={(e) => setCfg({ monthOffset: Number(e.target.value) })}>
                          <option value={0}>当月</option><option value={1}>翌月</option><option value={2}>翌々月</option><option value={3}>3ヶ月後</option>
                        </select></div>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">支払日</label>
                        <select className={`${input} bg-white`} value={cfg.paymentDay}
                          onChange={(e) => setCfg({ paymentDay: Number(e.target.value) })}>
                          {DAY_OPTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                        </select></div>
                    </div>
                  )}

                  {cfg.cycleType === "periodic" && (
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">支払日（毎月）</label>
                      <select className={`${input} bg-white`} value={cfg.paymentDay}
                        onChange={(e) => setCfg({ paymentDay: Number(e.target.value) })}>
                        {DAY_OPTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                      </select></div>
                  )}

                  {cfg.cycleType !== "none" && (
                    <>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">休業日にあたった場合</label>
                        <div className="flex flex-wrap gap-1.5">
                          {SHIFTS.map((s) => (
                            <button key={s.v} type="button" onClick={() => setCfg({ holidayShift: s.v })}
                              className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${cfg.holidayShift === s.v ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                              {s.label}
                            </button>
                          ))}
                        </div></div>

                      {/* 設定のプレビュー。保存前に間違いに気づけるようにする */}
                      {(() => {
                        const pv = previewExpected(todayIso(), cfg);
                        return (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                            <div className="text-[11px] font-bold text-emerald-800">プレビュー：この設定だと…</div>
                            <div className="text-[11.5px] text-emerald-900 leading-relaxed">
                              {fmtDateWithDow(todayIso())} に決済 → 入金予定日 <b>{fmtDateWithDow(pv.shifted)}</b>
                              {pv.wasShifted && <span className="text-emerald-700">（{fmtDateWithDow(pv.raw)} が休業日のため補正）</span>}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">決済手数料率（%）</label>
                      <input type="number" inputMode="decimal" step="0.001" min={0} className={input} value={cfg.feeRate || ""}
                        onChange={(e) => setCfg({ feeRate: Math.max(0, Number(e.target.value) || 0) })} placeholder="3.6" /></div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">固定手数料（円/件）</label>
                      <input type="number" inputMode="numeric" min={0} className={input} value={cfg.feeFixed || ""}
                        onChange={(e) => setCfg({ feeFixed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="0" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">端数処理</label>
                      <select className={`${input} bg-white`} value={cfg.feeRounding}
                        onChange={(e) => setCfg({ feeRounding: e.target.value as FeeRounding })}>
                        {ROUNDINGS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                      </select></div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">振込手数料（円/回）</label>
                      <input type="number" inputMode="numeric" min={0} className={input} value={cfg.transferFee || ""}
                        onChange={(e) => setCfg({ transferFee: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="250" />
                      <p className="text-[11px] text-gray-400 mt-1">1回の着金あたり。明細ではなく消込の差額に使います。</p></div>
                  </div>

                  <button type="button" onClick={() => setCfg({ autoCalc: !cfg.autoCalc })}
                    className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${cfg.autoCalc ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-600"}`}>
                    <span>{cfg.autoCalc ? "売上入力で自動計算する" : "自動計算しない（手入力のみ）"}</span>
                    <span className={`relative w-10 h-[21px] rounded-full ${cfg.autoCalc ? "bg-green-500" : "bg-gray-300"}`}><span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${cfg.autoCalc ? "left-[21px]" : "left-0.5"}`} /></span>
                  </button>
                </div>
              )}

              <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                <textarea className={`${input} min-h-[56px]`} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>

              {edit.id ? (
                <div className="rounded-xl border border-amber-200 bg-[#fffdf6] p-3 space-y-2.5">
                  <div className="text-[12px] font-bold text-amber-800">削除方法を選択</div>
                  <div className="flex items-start gap-2.5 border border-gray-200 rounded-lg bg-white px-3 py-2.5">
                    <div className="flex-1"><div className="text-[12.5px] font-bold text-gray-800">非表示にする（推奨）</div><div className="text-[11px] text-gray-500">一覧・選択肢から隠すが、過去の決済の参照は保持されます。</div></div>
                    <button onClick={doHide} className="shrink-0 text-[12px] font-semibold text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">非表示</button>
                  </div>
                  <div className="flex items-start gap-2.5 border border-red-200 rounded-lg bg-white px-3 py-2.5">
                    <div className="flex-1"><div className="text-[12.5px] font-bold text-gray-800">完全に削除する</div><div className="text-[11px] text-red-600">行ごと削除。参照中の過去決済の表示が「不明」になります。取り消せません。{!allowHardDelete && "（管理者のみ）"}</div></div>
                    <button onClick={doHardDelete} disabled={!allowHardDelete} className="shrink-0 text-[12px] font-bold text-red-600 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-40">完全削除…</button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              <div className="flex-1" />
              <button onClick={() => setEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <button onClick={doSave} className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">保存</button>
            </div>
          </div>
        </div>
        )}
      </div>
      )}
    </div>
  );
}
