"use client";
// ============================================================
// 経費入力（独立ルート /ops/expenses）
//
//   左：経費一覧（サマリ＋絞り込み）／右：登録・編集パネル（左右分割）。
//   売上入力（PaymentView）のミラー。違いは1点だけ：
//     売上 … 顧客を members に照合する
//     経費 … 支払先を名称で持ち、過去の実績からサジェストする
//
//   ・経費科目は expense_categories、支払サイト/方法は売上と共用のマスタから選ぶ。
//   ・出金予定日と支払手数料は支払サイトの設定から自動計算（緑地＝自動値）。
//   ・テーブル未作成（マイグレーション未適用）でも画面は開き、案内を出すだけにする。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  fetchExpenses, saveExpense, deleteExpense, fetchExpenseCategories,
  newExpense, recalcExpense, suggestVendors, isValidInvoiceNo, expensesAvailable,
} from "../../lib/expenses";
import { fetchMasterOptions, formatYen, nameOf } from "../../lib/payments";
import { describeCycle } from "../../lib/paymentSites";
import type { Expense, ExpenseCategory, PaymentMaster } from "../../lib/models";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

/** 自動計算で入った値。手で書き換えると通常の枠に戻る */
const autoInput = "w-full border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-900 focus:outline-none focus:border-emerald-500";
const fmtDt = (s: string) => (s ? s.replace("T", " ") : "—");
const mmdd = (s: string) => (s && s.length >= 10 ? s.slice(5, 10) : "");

/** 経費科目の表示名（未設定は "—"、削除済みは "不明(#id)"） */
function catName(list: ExpenseCategory[], id: number | null): string {
  if (id == null) return "—";
  const c = list.find((x) => x.id === id);
  return c ? c.name : `不明(#${id})`;
}

export function ExpenseView() {
  const confirm = useConfirm();
  const toast = useToast();

  const [rows, setRows] = useState<Expense[]>([]);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);
  const [methods, setMethods] = useState<PaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [eEdit, setEEdit] = useState<Expense | null>(null);
  const [vendorKw, setVendorKw] = useState("");
  /** テーブル未作成なら案内を出す（画面自体は開く） */
  const [unavailable, setUnavailable] = useState(false);

  const reload = async () => {
    try { setRows(await fetchExpenses()); }
    catch (e) { console.error("経費読込エラー:", e); }
  };

  useEffect(() => {
    (async () => {
      try {
        const [ex, cs, m] = await Promise.all([fetchExpenses(), fetchExpenseCategories(), fetchMasterOptions()]);
        setRows(ex); setCats(cs); setSites(m.sites); setMethods(m.methods);
        setUnavailable(expensesAvailable() === false);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const openEdit = (e: Expense) => {
    // 既存行を開いたとき、未設定の計上日・出金予定日を補って表示する
    setEEdit(recalcExpense({ ...e }, sites));
    setVendorKw("");
  };

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((e) =>
      [e.vendorName, e.note, catName(cats, e.categoryId)].some((s) => (s ?? "").toLowerCase().includes(k)));
  }, [rows, kw, cats]);

  const sumAmount = useMemo(() => filtered.reduce((s, e) => s + (e.amount || 0), 0), [filtered]);
  const sumFee = useMemo(() => filtered.reduce((s, e) => s + (e.feeAmount || 0), 0), [filtered]);
  const sumRecognized = useMemo(() => filtered.reduce((s, e) => s + (e.recognizedAmount || 0), 0), [filtered]);

  // ── 自動計算の連鎖（onChange から明示的に呼ぶ）──
  const applyAuto = (patch: Partial<Expense>) => {
    if (!eEdit) return;
    setEEdit(recalcExpense({ ...eEdit, ...patch }, sites));
  };
  const setManualDate = (v: string) => eEdit && setEEdit({ ...eEdit, expectedDate: v, isDateManual: true });
  const setManualFee = (v: number) => {
    if (!eEdit) return;
    const fee = Math.min(Math.max(0, Math.floor(v) || 0), Math.max(0, Math.round(eEdit.amount) || 0));
    setEEdit({ ...eEdit, feeAmount: fee, isFeeManual: true, recognizedAmount: Math.max(0, (Math.round(eEdit.amount) || 0) - fee) });
  };
  const backToAuto = (field: "date" | "fee") => {
    if (!eEdit) return;
    const base: Expense = field === "date" ? { ...eEdit, isDateManual: false } : { ...eEdit, isFeeManual: false };
    setEEdit(recalcExpense(base, sites));
  };

  /** 選択中の支払サイトの説明 */
  const siteHint = useMemo(() => {
    const s = eEdit?.siteId != null ? sites.find((x) => x.id === eEdit.siteId) : undefined;
    if (!s?.site || !s.site.autoCalc || s.site.cycleType === "none") return "";
    return `${s.name}：${describeCycle(s.site)}`;
  }, [eEdit?.siteId, sites]);

  /** 支払先のサジェスト（過去の経費から） */
  const vendorHits = useMemo(() => {
    if (!vendorKw.trim()) return [];
    return suggestVendors(rows, vendorKw).filter((v) => v !== eEdit?.vendorName);
  }, [rows, vendorKw, eEdit?.vendorName]);

  const invoiceOk = isValidInvoiceNo(eEdit?.vendorInvoiceNo ?? "");

  const doSave = async () => {
    if (!eEdit) return;
    if (!eEdit.paidAt) { alert("支払日時を入力してください"); return; }
    if (!eEdit.vendorName.trim()) { alert("支払先を入力してください"); return; }
    if (!eEdit.amount || eEdit.amount <= 0) { alert("支払金額を入力してください"); return; }
    if (eEdit.feeAmount > eEdit.amount) { alert("支払手数料が支払金額を超えています"); return; }
    if (!invoiceOk) { alert("インボイス登録番号は「T」＋数字13桁で入力してください"); return; }
    const res = await saveExpense(eEdit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setEEdit(null); await reload();
    toast.success("保存しました");
  };

  const doDelete = async () => {
    if (!eEdit?.id) return;
    if (!(await confirm({ title: "経費を削除", message: "この経費を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    await deleteExpense(eEdit.id); setEEdit(null); await reload();
    toast.success("削除しました");
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const detailOpen = !!eEdit;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">経費</h1>
        <span className="text-xs text-gray-400">支払・経費を登録します。売上と同じ考え方で計上日・出金予定日を持ちます。</span>
      </div>

      {unavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[12.5px] font-bold text-amber-800">経費テーブルがまだありません</div>
          <p className="text-[11.5px] text-amber-700 mt-1">
            この画面を使うには <code className="font-mono">supabase/migration_add_pl_ledger.sql</code> の適用が必要です。
            適用すると、経費の登録と経費科目マスタが使えるようになります。
          </p>
        </div>
      )}

      {/* サマリ */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">表示中 件数</div><div className="text-xl font-bold text-gray-800">{filtered.length} 件</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">支払金額 合計</div><div className="text-xl font-bold text-gray-800">{formatYen(sumAmount)}</div></div>
        {sumFee > 0 && (
          <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">支払手数料</div><div className="text-xl font-bold text-gray-800">{formatYen(sumFee)}</div></div>
        )}
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">経費計上額 合計</div><div className="text-xl font-bold text-red-600">− {formatYen(sumRecognized)}</div></div>
      </div>

      {/* ツールバー */}
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${input} max-w-xs`} placeholder="支払先・科目・備考で検索" value={kw} onChange={(e) => setKw(e.target.value)} />
        <div className="flex-1" />
        <button onClick={() => openEdit(newExpense())} disabled={unavailable}
          className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">＋ 経費を登録</button>
      </div>

      <div className={detailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start" : ""}>
        {/* ── 左：一覧 ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {filtered.length === 0 ? (
            <div className="text-center text-gray-300 py-10 text-sm">
              {unavailable ? "マイグレーション適用後に利用できます。" : "経費がありません。「＋ 経費を登録」から追加してください。"}
            </div>
          ) : filtered.map((e, i) => (
            <div key={e.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${eEdit && eEdit.id === e.id && e.id !== 0 ? "bg-red-50" : ""}`}>
              <div className="w-[92px] shrink-0">
                <div className="text-[11px] text-gray-500">{fmtDt(e.paidAt).slice(0, 16)}</div>
                {e.expectedDate && <div className="text-[10px] text-amber-600">出金予定 {mmdd(e.expectedDate)}</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{e.vendorName || "（支払先なし）"}</div>
                <div className="text-[11px] text-gray-400 truncate">{catName(cats, e.categoryId)} ・ {nameOf(sites, e.siteId)} / {nameOf(methods, e.methodId)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-red-600 tabular-nums">− {formatYen(e.recognizedAmount)}</div>
                <div className="text-[10.5px] text-gray-400 tabular-nums">総額 {formatYen(e.amount)}</div>
              </div>
              <button onClick={() => openEdit(e)} className="shrink-0 text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
            </div>
          ))}
        </div>

        {/* ── 右：編集パネル ── */}
        {eEdit && (
        <div className="lg:sticky lg:top-4 self-start min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{eEdit.id ? "経費を編集" : "経費を登録"}</h2>
              <button onClick={() => setEEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">支払日時 <span className="text-red-500">*</span></label>
                  <input type="datetime-local" className={input} value={eEdit.paidAt}
                    onChange={(e) => applyAuto({ paidAt: e.target.value })} /></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">計上日 <span className="text-red-500">*</span></label>
                  <input type="date" className={input} value={eEdit.accrualDate}
                    onChange={(e) => setEEdit({ ...eEdit, accrualDate: e.target.value })} />
                  <p className="text-[11px] text-gray-400 mt-1">経費を計上する月の基準。</p></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">出金予定日
                  {!eEdit.isDateManual && eEdit.expectedDate && <span className="ml-1 text-[10px] font-bold text-emerald-600">自動</span>}</label>
                  <input type="date" className={eEdit.isDateManual ? input : autoInput} value={eEdit.expectedDate}
                    onChange={(e) => setManualDate(e.target.value)} />
                  {eEdit.isDateManual
                    ? <button type="button" onClick={() => backToAuto("date")} className="text-[11px] text-indigo-600 hover:text-indigo-800 mt-1">自動に戻す</button>
                    : <p className="text-[11px] text-emerald-600 mt-1">{siteHint || "支払サイトを選ぶと自動計算します"}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">経費科目 <span className="text-red-500">*</span></label>
                  <select className={`${input} bg-white`} value={eEdit.categoryId ?? ""}
                    onChange={(e) => setEEdit({ ...eEdit, categoryId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isCost ? "（原価）" : ""}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">支払サイト</label>
                  <select className={`${input} bg-white`} value={eEdit.siteId ?? ""}
                    onChange={(e) => applyAuto({ siteId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">支払方法</label>
                  <select className={`${input} bg-white`} value={eEdit.methodId ?? ""}
                    onChange={(e) => setEEdit({ ...eEdit, methodId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-[#fafafa] p-3">
                <div className="text-[11px] font-bold text-gray-500 mb-2">金額</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">支払金額（総額・円） <span className="text-red-500">*</span></label>
                    <input type="number" inputMode="numeric" className={`${input} bg-white`} value={eEdit.amount || ""}
                      onChange={(e) => applyAuto({ amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="330000" /></div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">支払手数料（円）
                    {!eEdit.isFeeManual && eEdit.feeAmount > 0 && <span className="ml-1 text-[10px] font-bold text-emerald-600">自動</span>}</label>
                    <input type="number" inputMode="numeric" className={eEdit.isFeeManual ? `${input} bg-white` : autoInput} value={eEdit.feeAmount || ""}
                      onChange={(e) => setManualFee(Number(e.target.value))} placeholder="0" />
                    {eEdit.isFeeManual
                      ? <button type="button" onClick={() => backToAuto("fee")} className="text-[11px] text-indigo-600 hover:text-indigo-800 mt-1">自動に戻す</button>
                      : <p className="text-[11px] text-emerald-600 mt-1">支払サイトの率から自動計算</p>}
                  </div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">経費計上金額（円）</label>
                    <input type="number" inputMode="numeric" className={`${input} bg-white`} value={eEdit.recognizedAmount || ""}
                      onChange={(e) => setEEdit({ ...eEdit, recognizedAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)), isFeeManual: true })} placeholder="総額 − 手数料" />
                    <p className="text-[11px] text-gray-400 mt-1">一覧では − {formatYen(eEdit.recognizedAmount)} と表示。</p></div>
                </div>
              </div>

              {/* 支払先（売上側の「顧客照合」に代わる部分）*/}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
                <div className="text-[11px] font-bold text-gray-500">支払先</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className="text-[11px] text-gray-500 block mb-1">支払先名 <span className="text-red-500">*</span></label>
                    <input className={input} value={eEdit.vendorName}
                      onChange={(e) => { setEEdit({ ...eEdit, vendorName: e.target.value }); setVendorKw(e.target.value); }}
                      placeholder="株式会社◯◯広告" />
                    {vendorHits.length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden mt-1.5">
                        {vendorHits.map((v) => (
                          <button key={v} type="button" onClick={() => { setEEdit({ ...eEdit, vendorName: v }); setVendorKw(""); }}
                            className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1">過去の支払先から候補を出します。</p></div>
                  <div><label className="text-[11px] text-gray-500 block mb-1">インボイス登録番号</label>
                    <input className={`${input} font-mono ${invoiceOk ? "" : "border-amber-400 bg-amber-50"}`} value={eEdit.vendorInvoiceNo}
                      onChange={(e) => setEEdit({ ...eEdit, vendorInvoiceNo: e.target.value.trim() })} placeholder="T1234567890123" />
                    <p className={`text-[11px] mt-1 ${invoiceOk ? "text-gray-400" : "text-amber-700"}`}>
                      {invoiceOk ? "任意。将来の消費税対応で使います。" : "「T」＋数字13桁で入力してください。"}
                    </p></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">外部取引ID <span className="text-gray-400 font-normal">任意</span></label>
                  <input className={`${input} font-mono text-[12.5px]`} value={eEdit.externalTxnId}
                    onChange={(e) => setEEdit({ ...eEdit, externalTxnId: e.target.value })} placeholder="—" /></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">取得元</label>
                  <input className={input} value={eEdit.externalSource}
                    onChange={(e) => setEEdit({ ...eEdit, externalSource: e.target.value })} placeholder="bank / card" /></div>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                <textarea className={`${input} min-h-[64px]`} value={eEdit.note}
                  onChange={(e) => setEEdit({ ...eEdit, note: e.target.value })} placeholder="8月分 リスティング広告 など" /></div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {eEdit.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setEEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
