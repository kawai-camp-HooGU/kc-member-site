"use client";
// ============================================================
// 返金・解約マスタ編集（設定内）
//
//   解約区分①・解約区分②・進捗ステータスの3グループを編集する。
//   ・グループの表示名（「解約区分①」等）そのものを編集できる（refund_master_groups.label）。
//   ・各グループの選択肢（refund_masters）を追加／改名／並び替え／非表示。
//   ・進捗ステータスのみ「完了扱い(is_done)」を持ち、経費計上・完了判定のトリガにする。
//   決済マスタ編集（PaymentMasterView）と同じ流儀。
// ============================================================
import { useEffect, useState } from "react";
import {
  fetchRefundMasters, fetchRefundMasterGroups, saveRefundMaster, hideRefundMaster, saveRefundMasterGroupLabel,
} from "../../lib/refunds";
import type { RefundMaster, RefundMasterGroup, RefundMasterGroupKey } from "../../lib/models";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

const GROUP_ORDER: RefundMasterGroupKey[] = ["cancel_cat1", "cancel_cat2", "refund_status"];

export function RefundMasterView() {
  const confirm = useConfirm();
  const toast = useToast();
  const [groups, setGroups] = useState<RefundMasterGroup[]>([]);
  const [rows, setRows] = useState<RefundMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  const reload = async () => {
    const [gs, ms] = await Promise.all([fetchRefundMasterGroups(), fetchRefundMasters(true)]);
    setGroups(gs); setRows(ms);
    setLabelDraft(Object.fromEntries(gs.map((g) => [g.key, g.label])));
  };
  useEffect(() => { (async () => { try { await reload(); } catch (e) { console.error(e); } setLoading(false); })(); }, []);

  const groupLabel = (key: RefundMasterGroupKey) => groups.find((g) => g.key === key)?.label || key;
  const itemsOf = (key: RefundMasterGroupKey) => rows.filter((m) => m.groupKey === key).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const saveLabel = async (key: RefundMasterGroupKey) => {
    const label = (labelDraft[key] ?? "").trim();
    if (!label) { toast.error("名称を入力してください"); return; }
    const res = await saveRefundMasterGroupLabel(key, label);
    if (!res.ok) { toast.error(`保存に失敗：${res.error}`); return; }
    await reload(); toast.success("名称を更新しました");
  };

  const editItem = (m: RefundMaster, patch: Partial<RefundMaster>) => {
    setRows((prev) => prev.map((x) => (x === m || x.id === m.id ? { ...x, ...patch } : x)));
  };

  const saveItem = async (m: RefundMaster) => {
    if (!m.name.trim()) { toast.error("名称を入力してください"); return; }
    const res = await saveRefundMaster(m);
    if (res.id == null) { toast.error(`保存に失敗：${res.error}`); return; }
    await reload(); toast.success("保存しました");
  };

  const addItem = async (key: RefundMasterGroupKey) => {
    const maxSort = Math.max(0, ...itemsOf(key).map((m) => m.sortOrder));
    const res = await saveRefundMaster({ id: 0, groupKey: key, name: "新規項目", note: "", isDone: false, sortOrder: maxSort + 1, isDeleted: false });
    if (res.id == null) { toast.error(`追加に失敗：${res.error}`); return; }
    await reload();
  };

  const hideItem = async (m: RefundMaster) => {
    if (!(await confirm({ title: "非表示にする", message: `「${m.name}」を非表示にしますか？（参照中の記録は保持されます）`, confirmLabel: "非表示にする", danger: true }))) return;
    await hideRefundMaster(m.id); await reload(); toast.success("非表示にしました");
  };
  const showItem = async (m: RefundMaster) => { await saveRefundMaster({ ...m, isDeleted: false }); await reload(); };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">返金・解約マスタ</h1>
        <span className="text-xs text-gray-400">解約区分①/②・進捗ステータスの選択肢と、名称そのものを編集できます。</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {GROUP_ORDER.map((key) => (
          <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <label className="text-[11px] font-bold text-gray-500 block">マスタ名称（編集可）</label>
              <div className="flex gap-2">
                <input className={`${input} flex-1`} value={labelDraft[key] ?? ""} onChange={(e) => setLabelDraft((p) => ({ ...p, [key]: e.target.value }))} placeholder={groupLabel(key)} />
                <button onClick={() => saveLabel(key)} className="shrink-0 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg px-3 hover:bg-gray-50">名称保存</button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {itemsOf(key).map((m) => (
                <div key={m.id} className={`rounded-lg border p-2.5 space-y-2 ${m.isDeleted ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200"}`}>
                  <div className="flex items-center gap-2">
                    <input className={`${input} flex-1 py-1.5`} value={m.name} onChange={(e) => editItem(m, { name: e.target.value })} />
                    <input type="number" className={`${input} w-16 py-1.5`} value={m.sortOrder} onChange={(e) => editItem(m, { sortOrder: Number(e.target.value) || 0 })} title="並び順" />
                  </div>
                  {key === "refund_status" && (
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                      <input type="checkbox" checked={m.isDone} onChange={(e) => editItem(m, { isDone: e.target.checked })} />
                      完了扱い（経費計上・完了日時確定のトリガ）
                    </label>
                  )}
                  <div className="flex items-center gap-2">
                    <SaveButton onSave={() => saveItem(m)} />
                    {m.isDeleted
                      ? <button onClick={() => showItem(m)} className="text-[11px] font-semibold text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">再表示</button>
                      : <button onClick={() => hideItem(m)} className="text-[11px] font-semibold text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50">非表示</button>}
                  </div>
                </div>
              ))}
              <button onClick={() => addItem(key)} className="w-full text-xs font-semibold text-gray-600 border border-dashed border-gray-300 rounded-lg py-2 hover:bg-gray-50">＋ 選択肢を追加</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
