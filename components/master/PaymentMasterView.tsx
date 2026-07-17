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
  MASTER_LABEL, type MasterKind,
} from "../../lib/payments";
import type { PaymentMaster } from "../../lib/models";
import { useMaster } from "../../hooks/useMaster";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const KINDS: MasterKind[] = ["type", "site", "method"];

export function PaymentMasterView() {
  const { can } = useMaster();
  const confirm = useConfirm();
  const toast = useToast();
  const canHardDelete = can("payment_admin");

  const [kind, setKind] = useState<MasterKind>("type");
  const [rows, setRows] = useState<PaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [edit, setEdit] = useState<PaymentMaster | null>(null);

  const reload = async (k: MasterKind) => {
    try { setRows(await fetchMasters(k, true)); }
    catch (e) { console.error("マスタ読込エラー:", e); }
  };
  useEffect(() => { setLoading(true); reload(kind).finally(() => setLoading(false)); setEdit(null); }, [kind]);

  const visibleRows = useMemo(() => showHidden ? rows : rows.filter((r) => !r.isDeleted), [rows, showHidden]);
  const isType = kind === "type";

  const newMaster = (): PaymentMaster => ({
    id: 0, name: "", note: "", sortOrder: rows.length, isDeleted: false,
    salesFlag: isType ? true : undefined, requiredAmount: isType ? 0 : undefined,
  });

  const doSave = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { alert(`${MASTER_LABEL[kind]}名を入力してください`); return; }
    const res = await saveMaster(kind, edit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setEdit(null); await reload(kind);
    toast.success("保存しました");
  };
  const doHide = async () => {
    if (!edit?.id) return;
    await hideMaster(kind, edit.id); setEdit(null); await reload(kind);
    toast.success("非表示にしました（参照は保持されます）");
  };
  const doRestore = async (m: PaymentMaster) => {
    await saveMaster(kind, { ...m, isDeleted: false }); await reload(kind);
    toast.success("表示に戻しました");
  };
  const doHardDelete = async () => {
    if (!edit?.id) return;
    if (!canHardDelete) { toast.error("完全削除の権限がありません（管理者に依頼してください）"); return; }
    const ok = await confirm({
      title: "完全に削除しますか？",
      message: `「${edit.name}」を物理削除します。この番号を参照している過去の決済は表示が「不明」になります。取り消せません。`,
      confirmLabel: "完全削除する", danger: true,
    });
    if (!ok) return;
    const r = await hardDeleteMaster(kind, edit.id);
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
        <span className="text-xs text-gray-400">商品種別・決済サイト・決済方法を管理します（自動採番）。</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          {KINDS.map((k) => (
            <button key={k} type="button" className={seg(kind === k)} onClick={() => setKind(k)}>{MASTER_LABEL[k]}</button>
          ))}
        </div>
        <button onClick={() => setShowHidden((v) => !v)} className={`px-3 py-2 rounded-lg border text-sm font-semibold ${showHidden ? "border-gray-300 bg-gray-50 text-gray-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>非表示も表示</button>
        <div className="flex-1" />
        <button onClick={() => setEdit(newMaster())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 追加</button>
      </div>

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
              <h2 className="font-bold text-gray-800">{edit.id ? `${MASTER_LABEL[kind]}を編集` : `${MASTER_LABEL[kind]}を追加`}</h2>
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {edit.id ? (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">No.（自動採番・変更不可）</label>
                  <input className={`${input} bg-gray-100 text-gray-600 font-mono`} value={edit.id} readOnly /></div>
              ) : null}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">{MASTER_LABEL[kind]}名 <span className="text-red-500">*</span></label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>

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
                    <div className="flex-1"><div className="text-[12.5px] font-bold text-gray-800">完全に削除する</div><div className="text-[11px] text-red-600">行ごと削除。参照中の過去決済の表示が「不明」になります。取り消せません。{!canHardDelete && "（管理者のみ）"}</div></div>
                    <button onClick={doHardDelete} disabled={!canHardDelete} className="shrink-0 text-[12px] font-bold text-red-600 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-40">完全削除…</button>
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
