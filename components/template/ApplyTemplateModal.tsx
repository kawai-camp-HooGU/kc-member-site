"use client";
import { useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import type { Project } from "../../lib/models";

import { FIELD_INPUT } from "../../lib/constants";
export interface ApplyTemplateModalProps {
  project: Project;
  onClose: () => void;
  onApply: (templateId: number, baseDate: string) => void;
}

export function ApplyTemplateModal({ project, onClose, onApply }: ApplyTemplateModalProps) {
  const { templates } = useMaster();
  const [selectedId, setSelectedId] = useState<number | null>(templates[0]?.id ?? null);
  const [baseDate,   setBaseDate]   = useState<string>(project.startDate || new Date().toISOString().slice(0, 10));

  const selected = templates.find((t) => t.id === selectedId);
  const canApply = selectedId != null && Boolean(baseDate);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800 text-sm">テンプレート適用</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-500">「{project.name}」に分類とタスクを追記します</p>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">テンプレート</label>
          {templates.length === 0 ? (
            <p className="text-xs text-gray-400">テンプレートがありません。先にテンプレートを作成してください。</p>
          ) : (
            <>
              <select className={FIELD_INPUT}
                value={selectedId ?? ""} onChange={(e) => setSelectedId(Number(e.target.value))}>
                {templates.map((t) => <option key={t.id} value={t.id ?? ""}>{t.name}</option>)}
              </select>
              {selected && (
                <p className="text-xs text-gray-400 mt-1">
                  {selected.anken.length}分類 / {selected.anken.reduce((s, a) => s + a.tasks.length, 0)}タスクを追記
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">基準日（プロジェクト開始日）</label>
          <input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)}
            className={FIELD_INPUT} />
          <p className="text-xs text-gray-400 mt-1">タスクの日付はこの日を起点にオフセットで計算されます</p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 text-sm py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={() => { if (canApply && selectedId != null) onApply(selectedId, baseDate); }} disabled={!canApply || templates.length === 0}
            className="flex-1 text-sm py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">適用する</button>
        </div>
      </div>
    </div>
  );
}
