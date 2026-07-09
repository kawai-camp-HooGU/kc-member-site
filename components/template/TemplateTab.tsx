"use client";
import { useState } from "react";
import type { Template } from "../../lib/models";
import type { EditTemplate, EditTask } from "./types";
import { TemplateTaskEditModal } from "./TemplateTaskEditModal";
import { TemplateBulkRegisterModal } from "./TemplateBulkRegisterModal";

export interface TemplateTabProps {
  templates: Template[];
  onPersist: (t: EditTemplate) => void;
  onCreate: (name: string) => void;
  onDelete: (id: number) => void;
}

interface TaskModalState { tid: number; ai: number; ti: number | null; draft: EditTask; }

export function TemplateTab({ templates, onPersist, onCreate, onDelete }: TemplateTabProps) {
  const [openT, setOpenT] = useState<Set<number>>(() => new Set());
  const [openA, setOpenA] = useState<Set<string>>(() => new Set());
  const [taskModal, setTaskModal] = useState<TaskModalState | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const toggleT = (id: number) => setOpenT((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleA = (k: string)  => setOpenA((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const clone = (t: Template): EditTemplate => JSON.parse(JSON.stringify(t));
  const mutate = (tid: number, fn: (t: EditTemplate) => void) => { const t = templates.find((x) => x.id === tid); if (!t) return; const nt = clone(t); fn(nt); onPersist(nt); };

  const addAnken = (tid: number) => mutate(tid, (t) => { t.anken.push({ name: "新しい分類", tasks: [] }); });
  const delAnken = (tid: number, ai: number) => mutate(tid, (t) => { t.anken.splice(ai, 1); });
  const renameAnken = (tid: number, ai: number, name: string) => { const t = templates.find((x) => x.id === tid); if (!t || t.anken[ai]?.name === name) return; mutate(tid, (nt) => { nt.anken[ai].name = name; }); };
  const renameTemplate = (tid: number, name: string) => { const t = templates.find((x) => x.id === tid); if (!t || !name.trim() || t.name === name.trim()) return; mutate(tid, (nt) => { nt.name = name.trim(); }); };
  const delTask = (tid: number, ai: number, ti: number) => mutate(tid, (t) => { t.anken[ai].tasks.splice(ti, 1); });
  const saveTask = (draft: EditTask) => {
    if (!taskModal) return;
    const { tid, ai, ti } = taskModal;
    mutate(tid, (t) => { if (ti == null) t.anken[ai].tasks.push(draft); else t.anken[ai].tasks[ti] = draft; });
    setTaskModal(null);
  };

  const impChip = (imp: string | number | undefined) => {
    const k = String(imp ?? "none");
    const bg = k === "1" ? "bg-red-400" : k === "2" ? "bg-red-600" : k === "3" ? "bg-red-700" : "bg-gray-400";
    const label = k === "none" ? "なし" : k === "1" ? "Ⅰ" : k === "2" ? "Ⅱ" : "Ⅲ";
    return <span className={`text-[10px] text-white rounded-full px-2 py-0.5 ${bg}`}>{label}</span>;
  };
  const blank = (v: number | string | undefined) => v === "" || v == null;
  const dayLabel = (t: EditTask) => (blank(t.startOffset) && blank(t.endOffset)) ? "日付なし" : `${blank(t.startOffset) ? "—" : t.startOffset}〜${blank(t.endOffset) ? "—" : t.endOffset}日`;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-400">{templates.length} 件</p>
        {adding ? (
          <div className="flex items-center gap-2">
            <input autoFocus className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-red-400"
              value={newName} placeholder="テンプレート名" onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreate(newName); setNewName(""); setAdding(false); } }} />
            <button onClick={() => { if (newName.trim()) { onCreate(newName); setNewName(""); setAdding(false); } }}
              disabled={!newName.trim()}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-40">追加</button>
            <button onClick={() => { setAdding(false); setNewName(""); }} className="text-sm text-gray-500 px-2">×</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setBulkOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-blue-50">▤ 一括登録</button>
            <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">＋ 追加</button>
          </div>
        )}
      </div>

      {bulkOpen && <TemplateBulkRegisterModal onClose={() => setBulkOpen(false)} onPersist={onPersist} />}

      <div className="space-y-2">
        {templates.length === 0 && <div className="text-center text-gray-300 py-8 text-sm bg-white border border-gray-200 rounded-xl">テンプレートがありません</div>}
        {templates.map((t) => {
          const taskCount = t.anken.reduce((s, a) => s + a.tasks.length, 0);
          const openTpl = t.id != null && openT.has(t.id);
          return (
            <div key={t.id ?? t.name} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-600">
                <button onClick={() => t.id != null && toggleT(t.id)} className="text-red-100 hover:text-white text-sm w-4 text-center shrink-0">{openTpl ? "▼" : "▶"}</button>
                <input defaultValue={t.name} key={t.name}
                  onBlur={(e) => t.id != null && renameTemplate(t.id, e.target.value)}
                  className="font-semibold text-sm text-white bg-transparent border border-transparent hover:border-red-300 focus:border-white rounded px-1.5 py-0.5 focus:outline-none min-w-0 flex-1 placeholder-blue-200" />
                <span className="text-xs text-red-100 shrink-0">{t.anken.length}分類 / {taskCount}タスク</span>
                {openTpl && t.id != null && (
                  <button onClick={() => { addAnken(t.id!); setOpenT((s) => new Set(s).add(t.id!)); }}
                    className="text-xs text-white border border-red-300 rounded-md px-2 py-1 hover:bg-red-500 whitespace-nowrap shrink-0">＋ 分類を追加</button>
                )}
                <button onClick={() => t.id != null && onDelete(t.id)} className="text-xs text-red-100 hover:text-white hover:bg-red-500 rounded px-1.5 py-0.5 shrink-0">削除</button>
              </div>

              {openTpl && (
                <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
                  {t.anken.length === 0 && <p className="text-xs text-gray-300 text-center py-2">「＋ 分類を追加」で分類を追加してください</p>}
                  {t.anken.map((a, ai) => {
                    const k = `${t.id}:${ai}`;
                    const openAn = openA.has(k);
                    return (
                      <div key={ai} className="border border-red-200 border-l-4 border-l-blue-500 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 px-2.5 py-2 bg-red-100">
                          <button onClick={() => toggleA(k)} className="text-red-700 text-xs w-3.5 text-center shrink-0">{openAn ? "▼" : "▶"}</button>
                          <input defaultValue={a.name} key={a.name}
                            onBlur={(e) => t.id != null && renameAnken(t.id, ai, e.target.value)}
                            className="flex-1 min-w-0 text-sm font-medium text-red-900 bg-white border border-red-200 focus:border-red-500 rounded px-2 py-1 focus:outline-none" />
                          <span className="text-xs text-red-800 shrink-0">{a.tasks.length}タスク</span>
                          <button onClick={() => t.id != null && setTaskModal({ tid: t.id, ai, ti: null, draft: { name: "", importance: "none", startOffset: 0, endOffset: 7, progressMemo: "", specialNotes: "", materials: "" } })}
                            className="text-xs text-red-700 bg-white border border-red-300 rounded-md px-2 py-0.5 hover:bg-red-200 whitespace-nowrap shrink-0">＋ タスク追加</button>
                          <button onClick={() => t.id != null && delAnken(t.id, ai)} className="text-red-400 hover:text-red-600 text-sm px-1 shrink-0">×</button>
                        </div>
                        {openAn && (
                          <div className="bg-blue-50 px-3 py-2">
                            {a.tasks.length === 0 && <p className="text-xs text-gray-400 px-2 py-2">タスクがありません</p>}
                            {a.tasks.length > 0 && (
                              <div className="ml-3 border-l-2 border-red-200 pl-2 space-y-1.5">
                                {a.tasks.map((tk, ti) => (
                                  <div key={ti} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 border-l-2 border-l-blue-300 rounded-r-md">
                                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                      <span className="text-sm text-gray-800">{tk.name || <span className="text-gray-300">（名称未入力）</span>}</span>
                                      {impChip(tk.importance)}
                                      <span className="text-xs text-gray-400">{dayLabel(tk)}</span>
                                    </div>
                                    <button onClick={() => t.id != null && setTaskModal({ tid: t.id, ai, ti, draft: { ...tk } })}
                                      className="text-xs text-red-500 hover:text-red-700 px-2 shrink-0">編集</button>
                                    <button onClick={() => t.id != null && delTask(t.id, ai, ti)} className="text-red-300 hover:text-red-500 text-xs shrink-0">×</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {taskModal && (
        <TemplateTaskEditModal task={taskModal.draft}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
          onDelete={taskModal.ti != null ? () => { delTask(taskModal.tid, taskModal.ai, taskModal.ti!); setTaskModal(null); } : undefined} />
      )}
    </div>
  );
}
