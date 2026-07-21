"use client";
import { useState } from "react";
import { FIELD_INPUT, SELECT_WHITE_ARROW, importanceFillCls } from "../../lib/constants";
import { AutoGrowTextarea } from "../common/text";
import type { EditTask } from "./types";

export interface TemplateTaskEditModalProps {
  task: EditTask;
  onClose: () => void;
  onSave: (t: EditTask) => void;
  onDelete?: (() => void);
}

export function TemplateTaskEditModal({ task, onClose, onSave, onDelete }: TemplateTaskEditModalProps) {
  const [f, setF] = useState<EditTask>(() => ({
    name: task.name ?? "",
    importance: task.importance ?? "none",
    startOffset: task.startOffset ?? "",
    endOffset: task.endOffset ?? "",
    progressMemo: task.progressMemo ?? "",
    specialNotes: task.specialNotes ?? "",
    materials: task.materials ?? "",
  }));
  const set = (p: Partial<EditTask>) => setF((s) => ({ ...s, ...p }));
  const impKey = String(f.importance ?? "none");
  const SEL = "w-full border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none font-medium";
  const IN  = FIELD_INPUT;
  const TA  = FIELD_INPUT;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-800">タスク編集</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">タスク名 <span className="text-red-500">*</span></label>
            <input className={IN} value={f.name} placeholder="タスク名" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <div className="flex-[1.2]">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">重要度</label>
              <select style={SELECT_WHITE_ARROW} className={`${SEL} ${importanceFillCls(impKey)}`}
                value={impKey} onChange={(e) => { const k = e.target.value; set({ importance: k === "none" ? "none" : Number(k) }); }}>
                <option value="none">なし</option>
                <option value="1">Ⅰ（低）</option>
                <option value="2">Ⅱ（中）</option>
                <option value="3">Ⅲ（高）</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">開始日数</label>
              <input type="number" min="0" placeholder="—" className={IN} value={f.startOffset}
                onChange={(e) => set({ startOffset: e.target.value })} />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">終了日数</label>
              <input type="number" min="0" placeholder="—" className={IN} value={f.endOffset}
                onChange={(e) => set({ endOffset: e.target.value })} />
            </div>
          </div>
          <p className="text-[10px] text-gray-400 -mt-1.5">日数を空欄にすると、適用時に日付なしで作成されます。</p>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">進捗メモ</label>
            <AutoGrowTextarea minRows={2} className={TA} value={f.progressMemo ?? ""}
              placeholder="適用時にタスクへコピーされる初期メモ（任意）..."
              onChange={(e) => set({ progressMemo: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">特記事項</label>
            <AutoGrowTextarea minRows={2} className={TA} value={f.specialNotes ?? ""}
              placeholder="注意点・確認事項（任意）..."
              onChange={(e) => set({ specialNotes: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">資料</label>
            <AutoGrowTextarea minRows={2} className={TA} value={f.materials ?? ""}
              placeholder="関連ドキュメントのURL・ファイル名（任意）..."
              onChange={(e) => set({ materials: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
          {onDelete && (
            <button onClick={onDelete} className="text-sm py-2.5 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">削除</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={() => onSave(f)} disabled={!f.name.trim()}
            className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">保存</button>
        </div>
      </div>
    </div>
  );
}
