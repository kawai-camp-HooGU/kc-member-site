"use client";
import { useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { DEFAULT_FILTERS, applyFilters } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { IMPORTANCE_CONFIG, STATUS_CONFIG, SET_LABEL, projectBar } from "../lib/constants";
import type { Task, Risk } from "../lib/models";
import { ImportanceSummary, ProgressBar } from "../components/common/Badges";
import { SettingsPopover } from "../components/common/SettingsPopover";
import { FilterBar } from "../components/common/FilterBar";
import { TaskDetailPopup } from "../components/task/TaskDetailPopup";

export interface DashboardViewProps {
  tasks: Task[];
  onOpenView: (view: string, projectId: number) => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
}

export function DashboardView({ tasks, onOpenView, onSave, onDelete, onDuplicate }: DashboardViewProps) {
  const { projects, anken, permission } = useMaster();
  const [scopeFilter, setScopeFilter]   = useState<"all" | "mine">("all");
  const [filters, setFilters]           = useState<Filters>(DEFAULT_FILTERS);
  const [openProjects, setOpenProjects] = useState<Set<number>>(() => new Set());
  const [openAnken, setOpenAnken]       = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const today   = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  const visibleTasks = tasks.filter((t) => permission.canViewProject(t.projectId));
  const baseTasks   = visibleTasks;
  const scopedTasks = scopeFilter === "mine"
    ? baseTasks.filter((t) => t.assignees.includes(permission.myName))
    : baseTasks;
  const viewTasks  = applyFilters(scopedTasks, filters);

  const ankenStats = anken.map((a) => {
    const vt    = viewTasks.filter((t) => t.ankenId === a.id);
    const done  = vt.filter((t) => t.status === "completed").length;
    const total = vt.length;
    const highC = vt.filter((t) => t.risk === "high"    && t.status !== "completed").length;
    const caut  = vt.filter((t) => t.risk === "caution" && t.status !== "completed").length;
    const risk: Risk = highC > 0 ? "high" : caut > 0 ? "caution" : "normal";
    return {
      ...a,
      progress:       total > 0 ? Math.round(done / total * 100) : 0,
      risk,
      tasksCompleted: done,
      tasksTotal:     total,
      tasksDelayed:   vt.filter((t) => t.status !== "completed" && t.end && t.end < today).length,
      tasksDueThisWeek: vt.filter((t) => t.status !== "completed" && t.end && t.end >= today && t.end <= weekEnd).length,
      dueDate:        vt.reduce((m, t) => t.end > m ? t.end : m, ""),
    };
  });
  type AnkenStat = (typeof ankenStats)[number];

  const projStats = projects.filter((p) => !p.closeDate && permission.canViewProject(p.id)).map((p) => {
    const pTasks    = viewTasks.filter((t) => t.projectId === p.id);
    const pAnken    = ankenStats.filter((a) => a.projectId === p.id);
    const total     = pTasks.length;
    const done      = pTasks.filter((t) => t.status === "completed").length;
    const progress  = total > 0 ? Math.round(done / total * 100) : 0;
    const risk: Risk = pAnken.some((a) => a.risk === "high") ? "high"
                    : pAnken.some((a) => a.risk === "caution") ? "caution" : "normal";
    return { ...p, pTasks, pFilteredAnken: pAnken, total, done, progress, risk };
  });

  const handleSave   = (u: Task) => { onSave(u); setSelectedTask(u); };
  const handleDelete = (id: number) => { onDelete(id); setSelectedTask(null); };

  const scopeOptions = [{ key: "all", label: "全体" }, { key: "mine", label: "自分のみ" }] as const;

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-gray-50 -mx-4 px-4 pt-2 pb-3 space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1 h-5 rounded-sm bg-red-600" />
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M4 20h16" /></svg>
            <span className="text-base font-semibold tracking-wide text-gray-700">サマリー</span>
          </div>
          <ImportanceSummary tasks={viewTasks} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
        <SettingsPopover>
          <div>
            <div className={SET_LABEL}>表示</div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-max">
              {scopeOptions.map((s) => (
                <button key={s.key} onClick={() => setScopeFilter(s.key)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${scopeFilter === s.key ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  {s.key === "mine" ? `👤 ${s.label}` : s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <div className={SET_LABEL}>抽出条件</div>
            <FilterBar filters={filters} onChange={setFilters} />
          </div>
        </SettingsPopover>
        <span className="text-xs text-gray-500">
          表示：{scopeFilter === "mine" ? "自分のみ" : "全体"}
        </span>
        </div>
      </div>

      {projStats.map((p) => {
        const isProjOpen = openProjects.has(p.id);
        const toggleProj = () => setOpenProjects((prev) => {
          const n = new Set(prev);
          if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
          return n;
        });
        return (
          <div key={p.id} className="bg-white rounded-xl border-2 border-red-200 shadow-sm">
            <div className="p-4 cursor-pointer" onClick={toggleProj}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-white px-2.5 py-1 rounded-lg ${projectBar(p.id)}`}>
                      <span className="text-[10px] font-bold border border-white/50 rounded px-1 leading-none">PJ</span>
                      <span className="font-bold text-base leading-none">{p.name}</span>
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    分類 {p.pFilteredAnken.length} / タスク {p.total} / 完了 {p.done}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 mr-1">
                    <button onClick={(e) => { e.stopPropagation(); onOpenView && onOpenView("gantt", p.id); }}
                      className="text-xs px-2.5 py-1 rounded-md border border-red-200 bg-blue-50 text-red-700 hover:bg-red-100 transition-colors font-medium">
                      ≡ ガント
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onOpenView && onOpenView("calendar", p.id); }}
                      className="text-xs px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-medium">
                      ▦ カレンダー
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onOpenView && onOpenView("kanban", p.id); }}
                      className="text-xs px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors font-medium">
                      ⊞ カンバン
                    </button>
                  </div>
                  <span className="text-xs text-gray-400">{p.progress}%</span>
                  <span className="text-gray-400 text-sm">{isProjOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              <ProgressBar progress={p.progress} risk={p.risk} />
            </div>

            {isProjOpen && (
              <div className="border-t border-red-100 p-3 space-y-3">
                <ImportanceSummary tasks={p.pTasks} />
                {p.pFilteredAnken.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-4">該当する分類がありません</div>
                )}
                {p.pFilteredAnken.map((a: AnkenStat) => {
                  const isOpen     = openAnken === a.id;
                  const ankenTasks = viewTasks.filter((t) => t.ankenId === a.id);
                  const myCount    = ankenTasks.filter((t) => t.assignees.includes(permission.myName)).length;
                  return (
                    <div key={a.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setOpenAnken(isOpen ? null : a.id); }}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">分類</span>
                              <span className="font-semibold text-gray-800">{a.name}</span>
                              {myCount > 0 && scopeFilter === "mine" && (
                                <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 border border-purple-200">
                                  自分 {myCount}件
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              リーダー：{a.leader}　タスク：{a.tasksTotal}件　完了：{a.tasksCompleted}件
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <div className="text-xs text-gray-400">期限：{a.dueDate}</div>
                            <span className="text-gray-400 text-sm">{isOpen ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        <ProgressBar progress={a.progress} risk={a.risk} />
                      </div>

                      {isOpen && (
                        <div className="border-t border-gray-100 bg-gray-50 px-3 pb-3 pt-2">
                          <div className="mb-3">
                            <ImportanceSummary tasks={ankenTasks} compact />
                          </div>
                          <div className="space-y-1">
                            {ankenTasks.map((t) => (
                              <div key={t.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }}
                                className="flex items-center justify-between text-xs cursor-pointer hover:bg-white rounded-md px-2 py-1.5 transition-colors border border-transparent hover:border-gray-200">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 ${(IMPORTANCE_CONFIG[t.importance ?? "none"] ?? IMPORTANCE_CONFIG.none).chip}`}>
                                    {(IMPORTANCE_CONFIG[t.importance ?? "none"] ?? IMPORTANCE_CONFIG.none).icon || "なし"}
                                  </span>
                                  <span className="text-gray-700 truncate">{t.name}</span>
                                </div>
                                <span className={`ml-2 px-2 py-0.5 rounded-full border shrink-0 ${
                                  t.status === "completed"   ? "bg-neutral-200 text-neutral-700 border-neutral-300"   :
                                  t.status === "in_progress" ? "bg-green-100 text-green-700 border-green-200" :
                                  "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                  {STATUS_CONFIG[t.status].label}
                                </span>
                              </div>
                            ))}
                            {ankenTasks.length === 0 && (
                              <div className="text-center text-gray-300 text-xs py-4">タスクなし</div>
                            )}
                          </div>
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

      <TaskDetailPopup task={selectedTask} onClose={() => setSelectedTask(null)} onSave={handleSave} onDelete={handleDelete}
        onDuplicate={onDuplicate}
        canEdit={selectedTask ? permission.canEditTask(selectedTask) : false} />
    </div>
  );
}
