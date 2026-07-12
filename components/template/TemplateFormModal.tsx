"use client";
import { useState } from "react";
import { importanceFillCls, SELECT_WHITE_ARROW } from "../../lib/constants";
import { SaveButton } from "../common/SaveButton";
import type { Template } from "../../lib/models";
import type { EditTemplate, EditTask } from "./types";

export interface TemplateFormModalProps {
  form: Template;
  onClose: () => void;
  onSave: (t: EditTemplate) => void | Promise<void>;
  onDelete?: (() => void) | null;
}

export function TemplateFormModal({ form, onClose, onSave, onDelete }: TemplateFormModalProps) {
  const [tmpl, setTmpl] = useState<EditTemplate>(() => JSON.parse(JSON.stringify(form)));
  const [bulkTarget, setBulkTarget] = useState<number | null>(null);
  const [bulkText, setBulkText]     = useState("");

  const addAnken = () => setTmpl((t) => ({ ...t, anken: [...t.anken, { name: "", tasks: [] }] }));
  const removeAnken = (ai: number) => setTmpl((t) => ({ ...t, anken: t.anken.filter((_, i) => i !== ai) }));
  const updateAnkenName = (ai: number, name: string) => setTmpl((t) => ({ ...t, anken: t.anken.map((a, i) => i === ai ? { ...a, name } : a) }));

  const addTask = (ai: number) => setTmpl((t) => ({
    ...t,
    anken: t.anken.map((a, i) => i === ai ? { ...a, tasks: [...a.tasks, { name: "", startOffset: 0, endOffset: 7, importance: "none" }] } : a),
  }));

  const updateTask = (ai: number, ti: number, field: string, value: string) => setTmpl((t) => ({
    ...t,
    anken: t.anken.map((a, i) => i === ai
      ? { ...a, tasks: a.tasks.map((tk, j) => j === ti ? { ...tk, [field]: value } as EditTask : tk) }
      : a),
  }));

  const removeTask = (ai: number, ti: number) => setTmpl((t) => ({
    ...t,
    anken: t.anken.map((a, i) => i === ai ? { ...a, tasks: a.tasks.filter((_, j) => j !== ti) } : a),
  }));

  const parseBulk = () => {
    const numOrBlank = (v: string): number | string => {
      const s = (v ?? "").trim();
      if (s === "") return "";
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? "" : n;
    };
    const impFromText = (v: string): string => {
      const s = (v ?? "").trim();
      if (["3", "Ⅲ", "III", "高"].includes(s)) return "3";
      if (["2", "Ⅱ", "II", "中"].includes(s)) return "2";
      if (["1", "Ⅰ", "I", "低"].includes(s)) return "1";
      return "none";
    };
    const newTasks: EditTask[] = bulkText.trim().split("\n")
      .map((line) => line.split("\t"))
      .filter((cols) => cols.length >= 1 && (cols[0] ?? "").trim())
      .map((cols) => ({
        name: (cols[0] ?? "").trim(),
        startOffset: numOrBlank(cols[1] ?? ""),
        endOffset: numOrBlank(cols[2] ?? ""),
        importance: impFromText(cols[3] ?? ""),
      }));
    setTmpl((t) => ({ ...t, anken: t.anken.map((a, i) => i === bulkTarget ? { ...a, tasks: [...a.tasks, ...newTasks] } : a) }));
    setBulkTarget(null);
    setBulkText("");
  };

  const canSave = Boolean(tmpl.name.trim() && tmpl.anken.length > 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{tmpl.id ? "テンプレート編集" : "テンプレート追加"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">テンプレート名 <span className="text-red-500">*</span></label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
              value={tmpl.name} placeholder="例：LP制作標準"
              onChange={(e) => setTmpl((t) => ({ ...t, name: e.target.value }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500">分類</label>
              <button onClick={addAnken}
                className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-blue-50 transition-colors">
                ＋ 分類を追加
              </button>
            </div>

            <div className="space-y-3">
              {tmpl.anken.length === 0 && (
                <div className="text-center text-gray-300 text-xs py-4 border border-dashed border-gray-200 rounded-lg">
                  「＋ 分類を追加」から分類を追加してください
                </div>
              )}
              {tmpl.anken.map((a, ai) => (
                <div key={ai} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <input className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-red-400"
                      value={a.name} placeholder="分類名"
                      onChange={(e) => updateAnkenName(ai, e.target.value)} />
                    <button onClick={() => removeAnken(ai)} className="text-red-400 hover:text-red-600 text-sm px-1 shrink-0">✕</button>
                  </div>

                  <div className="px-3 py-2">
                    {a.tasks.length > 0 && (
                      <div className="mb-2">
                        <div className="grid gap-1 mb-1 px-1 text-xs text-gray-400" style={{ gridTemplateColumns: "1fr 64px 52px 52px 20px" }}>
                          <span>タスク名</span><span className="text-center">重要度</span><span className="text-center">開始日数</span><span className="text-center">終了日数</span><span />
                        </div>
                        {a.tasks.map((tk, ti) => {
                          const impKey = String(tk.importance ?? "none");
                          const impCls = importanceFillCls(impKey);
                          return (
                          <div key={ti} className="grid gap-1 mb-1" style={{ gridTemplateColumns: "1fr 64px 52px 52px 20px" }}>
                            <input className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-red-400"
                              value={tk.name} placeholder="タスク名"
                              onChange={(e) => updateTask(ai, ti, "name", e.target.value)} />
                            <select style={SELECT_WHITE_ARROW}
                              className={`border rounded pl-2 pr-5 py-1 text-xs focus:outline-none font-medium ${impCls}`}
                              value={impKey}
                              onChange={(e) => updateTask(ai, ti, "importance", e.target.value)}>
                              <option value="none">なし</option>
                              <option value="1">Ⅰ</option>
                              <option value="2">Ⅱ</option>
                              <option value="3">Ⅲ</option>
                            </select>
                            <input type="number" min="0" placeholder="—"
                              className="border border-gray-200 rounded px-1 py-1 text-xs text-center focus:outline-none focus:border-red-400"
                              value={tk.startOffset}
                              onChange={(e) => updateTask(ai, ti, "startOffset", e.target.value)} />
                            <input type="number" min="0" placeholder="—"
                              className="border border-gray-200 rounded px-1 py-1 text-xs text-center focus:outline-none focus:border-red-400"
                              value={tk.endOffset}
                              onChange={(e) => updateTask(ai, ti, "endOffset", e.target.value)} />
                            <button onClick={() => removeTask(ai, ti)} className="text-red-300 hover:text-red-500 text-xs leading-none">✕</button>
                          </div>
                          );
                        })}
                        <p className="text-[10px] text-gray-400 px-1 mt-0.5">日数を空欄にすると、適用時に日付なしで作成されます。</p>
                      </div>
                    )}

                    {bulkTarget === ai ? (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400">タスク名[TAB]開始日数[TAB]終了日数[TAB]重要度 の形式（日数・重要度は省略可。重要度はⅠ/Ⅱ/Ⅲ）</p>
                        <textarea rows={4}
                          className="w-full border border-red-300 rounded-lg px-3 py-2 text-xs focus:outline-none resize-none font-mono"
                          value={bulkText}
                          onChange={(e) => setBulkText(e.target.value)}
                          placeholder={"ヒアリング\t0\t7\t Ⅲ\n競合調査\t3\t14\n資料整理\t\t\tⅠ"} />
                        <div className="flex gap-2">
                          <button onClick={() => { setBulkTarget(null); setBulkText(""); }}
                            className="flex-1 text-xs py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
                          <button onClick={parseBulk}
                            className="flex-1 text-xs py-1.5 rounded bg-red-600 text-white hover:bg-red-700">追加</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => addTask(ai)}
                          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 transition-colors">
                          ＋ タスク追加
                        </button>
                        <button onClick={() => { setBulkTarget(ai); setBulkText(""); }}
                          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 transition-colors">
                          一括ペースト
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 items-center">
          {onDelete && tmpl.id && (
            <button onClick={onDelete}
              className="text-sm py-2.5 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">削除</button>
          )}
          <button onClick={onClose}
            className="flex-1 text-sm py-2.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
            キャンセル
          </button>
          <SaveButton onSave={() => onSave(tmpl)} disabled={!canSave}
            className="flex-1 text-sm py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            保存する
          </SaveButton>
        </div>
      </div>
    </div>
  );
}
