"use client";
// ============================================================
// 返金・解約マスタ編集（設定内・決済マスタと同じ流儀）
//
//   解約区分①・解約区分②・進捗ステータスの3グループをタブで切替。自動採番（No.）。
//   ・各グループの選択肢（refund_masters）を 追加／改名／備考／並べ替え（ドラッグ）／非表示／完全削除。
//   ・グループの表示名（「解約区分①」等）そのものも編集できる（refund_master_groups.label）。
//   ・進捗ステータスのみ「完了扱い(is_done)」を持ち、経費計上・完了判定のトリガにする。
//   ・完全削除（物理）は refund_admin 権限のみ。非表示（論理削除）は参照を保持（推奨）。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  fetchRefundMasters, fetchRefundMasterGroups, saveRefundMaster, hideRefundMaster,
  hardDeleteRefundMaster, reorderRefundMasters, saveRefundMasterGroupLabel,
} from "../../lib/refunds";
import type { RefundMaster, RefundMasterGroup, RefundMasterGroupKey } from "../../lib/models";
import { useMaster } from "../../hooks/useMaster";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

const GROUP_ORDER: RefundMasterGroupKey[] = ["cancel_cat1", "cancel_cat2", "refund_status"];
const FALLBACK_LABEL: Record<RefundMasterGroupKey, string> = { cancel_cat1: "解約区分①", cancel_cat2: "解約区分②", refund_status: "解約進捗ステータス" };

export function RefundMasterView() {
  const { can } = useMaster();
  const confirm = useConfirm();
  const toast = useToast();
  const canHardDelete = can("refund_admin");

  const [kind, setKind] = useState<RefundMasterGroupKey>("cancel_cat1");
  const [groups, setGroups] = useState<RefundMasterGroup[]>([]);
  const [rows, setRows] = useState<RefundMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [edit, setEdit] = useState<RefundMaster | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);

  const reload = async () => {
    try {
      const [gs, ms] = await Promise.all([fetchRefundMasterGroups(), fetchRefundMasters(true)]);
      setGroups(gs); setRows(ms);
    } catch (e) { console.error("返金マスタ読込エラー:", e); }
  };
  useEffect(() => { (async () => { await reload(); setLoading(false); })(); }, []);

  const groupLabel = (key: RefundMasterGroupKey) => groups.find((g) => g.key === key)?.label || FALLBACK_LABEL[key];
  useEffect(() => { setLabelDraft(groupLabel(kind)); setEdit(null); /* eslint-disable-next-line */ }, [kind, groups]);

  const isStatus = kind === "refund_status";
  const groupRows = useMemo(
    () => rows.filter((m) => m.groupKey === kind).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [rows, kind]);
  const visibleRows = useMemo(() => showHidden ? groupRows : groupRows.filter((r) => !r.isDeleted), [groupRows, showHidden]);

  const newMaster = (): RefundMaster => ({
    id: 0, groupKey: kind, name: "", note: "", isDone: false,
    sortOrder: groupRows.length + 1, isDeleted: false,
  });

  const saveLabel = async () => {
    const label = labelDraft.trim();
    if (!label) { toast.error("名称を入力してください"); return; }
    const res = await saveRefundMasterGroupLabel(kind, label);
    if (!res.ok) { toast.error(`保存に失敗：${res.error}`); return; }
    await reload(); toast.success("マスタ名称を更新しました");
  };

  const doSave = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { alert("名称を入力してください"); return; }
    const res = await saveRefundMaster(edit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setEdit(null); await reload(); toast.success("保存しました");
  };
  const doHide = async () => {
    if (!edit?.id) return;
    await hideRefundMaster(edit.id); setEdit(null); await reload();
    toast.success("非表示にしました（参照は保持されます）");
  };
  const doRestore = async (m: RefundMaster) => {
    await saveRefundMaster({ ...m, isDeleted: false }); await reload();
    toast.success("表示に戻しました");
  };
  const doHardDelete = async () => {
    if (!edit?.id) return;
    if (!canHardDelete) { toast.error("完全削除の権限がありません（管理者に依頼してください）"); return; }
    const ok = await confirm({
      title: "完全に削除しますか？",
      message: `「${edit.name}」を物理削除します。この番号を参照している過去の返金・解約は表示が「不明」になります。取り消せません。`,
      confirmLabel: "完全削除する", danger: true,
    });
    if (!ok) return;
    const r = await hardDeleteRefundMaster(edit.id);
    if (!r.ok) { toast.error(`削除に失敗しました：${r.error}`); return; }
    setEdit(null); await reload(); toast.success("完全に削除しました");
  };

  // ── ドラッグ並べ替え（グループ内）──
  const onDrop = async (targetId: number) => {
    if (dragId == null || dragId === targetId) { setDragId(null); return; }
    const ids = groupRows.map((m) => m.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragId(null);
    const res = await reorderRefundMasters(ids);
    if (!res.ok) { toast.error(`並べ替えに失敗：${res.error}`); return; }
    await reload();
  };

  const seg = (on: boolean) =>
    `px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${on ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`;

  const detailOpen = !!edit;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">返金・解約マスタ</h1>
        <span className="text-xs text-gray-400">解約区分①/②・進捗ステータスの選択肢と、マスタ名称そのものを編集できます（自動採番）。</span>
      </div>

      {/* グループタブ */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          {GROUP_ORDER.map((k) => (
            <button key={k} type="button" className={seg(kind === k)} onClick={() => setKind(k)}>{groupLabel(k)}</button>
          ))}
        </div>
        <button onClick={() => setShowHidden((v) => !v)} className={`px-3 py-2 rounded-lg border text-sm font-semibold ${showHidden ? "border-gray-300 bg-gray-50 text-gray-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>非表示も表示</button>
        <div className="flex-1" />
        <button onClick={() => setEdit(newMaster())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 追加</button>
      </div>

      {/* マスタ名称（グループ表示名）の編集 */}
      <div className="flex items-center gap-2 flex-wrap bg-[#faf9f7] border border-gray-100 rounded-xl px-4 py-3">
        <label className="text-[11px] font-bold text-gray-500">マスタ名称（編集可）</label>
        <input className={`${input} max-w-xs`} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} placeholder={FALLBACK_LABEL[kind]} />
        <button onClick={saveLabel} className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-white">名称を保存</button>
        <span className="text-[11px] text-gray-400">「{FALLBACK_LABEL[kind]}」というマスタの呼び名そのものを変更できます。</span>
      </div>

      {loading ? <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p> : (
      <div className={detailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 items-start" : ""}>
        {/* 一覧 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {visibleRows.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">まだありません。「＋ 追加」から登録してください。</div>
            : visibleRows.map((m, i) => (
              <div key={m.id}
                draggable
                onDragStart={() => setDragId(m.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(m.id)}
                className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-gray-100" : ""} ${edit && edit.id === m.id && m.id !== 0 ? "bg-red-50" : ""} ${m.isDeleted ? "opacity-55" : ""} ${dragId === m.id ? "bg-indigo-50" : ""}`}>
                <span className="shrink-0 text-gray-300 cursor-grab select-none" title="ドラッグで並べ替え">⋮⋮</span>
                <span className="w-8 shrink-0 text-[12px] font-mono text-gray-500">{m.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{m.name || "（無名）"}</div>
                  {m.note && <div className="text-[11px] text-gray-400 truncate">{m.note}</div>}
                </div>
                {isStatus && m.isDone && <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">完了扱い</span>}
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
              <h2 className="font-bold text-gray-800">{edit.id ? `${groupLabel(kind)}を編集` : `${groupLabel(kind)}を追加`}</h2>
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {edit.id ? (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">No.（自動採番・変更不可）</label>
                  <input className={`${input} bg-gray-100 text-gray-600 font-mono`} value={edit.id} readOnly /></div>
              ) : null}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">名称 <span className="text-red-500">*</span></label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={isStatus ? "確認中 など" : "中途解約 など"} /></div>

              {isStatus && (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">完了扱い</label>
                  <button onClick={() => setEdit({ ...edit, isDone: !edit.isDone })} className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${edit.isDone ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-600"}`}>
                    <span>{edit.isDone ? "完了扱いにする" : "完了扱いにしない"}</span>
                    <span className={`relative w-10 h-[21px] rounded-full ${edit.isDone ? "bg-green-500" : "bg-gray-300"}`}><span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.isDone ? "left-[21px]" : "left-0.5"}`} /></span>
                  </button>
                  <p className="text-[11px] text-gray-400 mt-1">このステータスに到達したら経費計上・返金完了日時を確定するトリガになります。</p></div>
              )}

              <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                <textarea className={`${input} min-h-[56px]`} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="運用メモなど" /></div>

              {edit.id ? (
                <div className="rounded-xl border border-amber-200 bg-[#fffdf6] p-3 space-y-2.5">
                  <div className="text-[12px] font-bold text-amber-800">削除方法を選択</div>
                  <div className="flex items-start gap-2.5 border border-gray-200 rounded-lg bg-white px-3 py-2.5">
                    <div className="flex-1"><div className="text-[12.5px] font-bold text-gray-800">非表示にする（推奨）</div><div className="text-[11px] text-gray-500">一覧・選択肢から隠すが、過去の返金・解約の参照は保持されます。</div></div>
                    <button onClick={doHide} className="shrink-0 text-[12px] font-semibold text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">非表示</button>
                  </div>
                  <div className="flex items-start gap-2.5 border border-red-200 rounded-lg bg-white px-3 py-2.5">
                    <div className="flex-1"><div className="text-[12.5px] font-bold text-gray-800">完全に削除する</div><div className="text-[11px] text-red-600">行ごと削除。参照中の過去記録の表示が「不明」になります。取り消せません。{!canHardDelete && "（管理者のみ）"}</div></div>
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
