"use client";
import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { useMaster } from "../hooks/useMaster";
import { useRoute } from "../hooks/useRoute";
import { applyFilters } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { KANBAN_COLS, IMPORTANCE_CONFIG, SET_LABEL, projectBadge } from "../lib/constants";
import { daysBetween } from "../lib/dateUtils";
import { celebrateDone, getCompletionMessage } from "../lib/celebrate";
import type { Task, Status } from "../lib/models";
import { SettingsPopover } from "../components/common/SettingsPopover";
import { NewTaskModal } from "../components/task/NewTaskModal";
import { FilterBar } from "../components/common/FilterBar";
import { ColorRulePopover } from "../components/common/ColorRulePopover";
import { TaskDetailPopup } from "../components/task/TaskDetailPopup";

export interface KanbanViewProps {
  tasks: Task[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
}

export function KanbanView({ tasks, filters, onFiltersChange, onSave, onDelete, onDuplicate }: KanbanViewProps) {
  const { projects, anken: ankenList, permission, can } = useMaster();
  const [draggingId, setDraggingId]     = useState<number | null>(null);
  const [justMoved, setJustMoved]       = useState<{ id: number; col: Status } | null>(null);
  // タスク詳細ポップアップは URL のクエリで開閉する（?task=88）
  const route = useRoute();
  const selectedTask = tasks.find((t) => t.id === route.qNum("task")) ?? null;
  const setSelectedTask = (t: Task | null) => route.setQuery({ task: t?.id ?? null });
  const [addStatus, setAddStatus]       = useState<Status | null>(null);
  const canAddTask = can("bulk_register");
  const cardRefs = useRef<Record<number, HTMLDivElement>>({});

  const kanbanFilters: Filters = { ...filters, assignee: [] };

  const accessibleTasks = tasks.filter((t) =>
    permission.canViewProject(t.projectId) && t.assignees.includes(permission.myName));
  const visibleTasks = applyFilters(accessibleTasks, kanbanFilters);

  const onDrop = (col: Status) => {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (task && permission.canEditTask(task) && task.status !== col) {
      onSave({ ...task, status: col });
      setJustMoved({ id: task.id, col });
      if (col === "completed") celebrateDone(getCompletionMessage(task));
    }
    setDraggingId(null);
  };

  useEffect(() => {
    if (!justMoved) return;
    const moved = visibleTasks.find((t) => t.id === justMoved.id);
    if (!moved || moved.status !== justMoved.col) return;
    const el = cardRefs.current[justMoved.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setJustMoved(null), 2500);
    return () => clearTimeout(timer);
  }, [justMoved, visibleTasks]);

  const handleSave = (updated: Task) => {
    onSave(updated);
    setSelectedTask(updated);
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 bg-white pb-2 border-b border-gray-100 flex items-center">
        <SettingsPopover>
          <div>
            <div className={SET_LABEL}>抽出条件</div>
            <FilterBar filters={filters} onChange={onFiltersChange} hide={["assignee"]} />
          </div>
        </SettingsPopover>
        <div className="ml-2"><ColorRulePopover variant="kanban" /></div>
        <p className="text-xs text-gray-400 text-center flex-1">ドラッグ&amp;ドロップでステータス変更 / タップで詳細・編集</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {KANBAN_COLS.map((col) => {
          const colTasks = visibleTasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key}
              className={`rounded-xl border-2 ${col.color} p-3 min-h-64`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(col.key)}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-gray-700">{col.label}</span>
                <span className="bg-white text-gray-500 text-xs rounded-full px-2 py-0.5 border">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((task) => {
                  const proj  = projects.find((p) => p.id === task.projectId);
                  const anken = ankenList.find((a) => a.id === task.ankenId);
                  const impCfg = IMPORTANCE_CONFIG[task.importance ?? "none"] ?? IMPORTANCE_CONFIG.none;
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const hasDates = !!(task.start && task.end);
                  const isCompleted = task.status === "completed";
                  const isOverdue = hasDates && !isCompleted && task.end < todayStr;
                  const daysLeft = hasDates ? daysBetween(todayStr, task.end) : Infinity;
                  const isDueThisWeek = hasDates && !isCompleted && !isOverdue && daysLeft <= 7;
                  const isNoDate = !hasDates && !isCompleted;
                  const isImpIII = task.importance === 3;
                  const cardStyle: CSSProperties | undefined = isCompleted   ? { background: "#edeef0" }
                                  : isOverdue     ? { background: "repeating-linear-gradient(45deg,#fde4e4,#fde4e4 7px,#f7cccc 7px,#f7cccc 14px)", borderLeft: "4px solid #dc2626" }
                                  : isDueThisWeek ? { background: "#ffe8cc", borderLeft: "4px solid #f97316" }
                                  : isImpIII      ? { background: "#fff0f0" }
                                  : undefined;
                  const cardLabel: { t: string; cls: string } | null = isOverdue     ? { t: "超過",     cls: "bg-red-600"   }
                                  : isDueThisWeek ? { t: "今週期限", cls: "bg-orange-500" }
                                  : isNoDate      ? { t: "日付なし", cls: "bg-gray-400"  }
                                  : null;
                  const imp = (task.importance && task.importance !== "none") ? task.importance : null;
                  const nameWeight = imp === 3 ? "font-bold" : "font-medium";
                  const nameClr = isCompleted ? "text-gray-400 line-through" : (imp ? IMPORTANCE_CONFIG[imp].ganttText : "text-gray-800");
                  return (
                    <div key={task.id}
                      ref={(el) => { if (el) cardRefs.current[task.id] = el; }}
                      draggable
                      onDragStart={() => setDraggingId(task.id)}
                      onClick={() => setSelectedTask(task)}
                      style={cardStyle}
                      className={`rounded-lg border p-3 cursor-pointer shadow-sm hover:shadow-md transition-all duration-300 bg-white ${justMoved?.id === task.id ? "border-red-400 ring-2 ring-red-400 ring-offset-1 shadow-lg" : "border-gray-200"}`}>
                      <div className="flex flex-wrap items-center gap-1 mb-2">
                        {impCfg.icon && <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${impCfg.chip}`}>重要度{impCfg.icon}</span>}
                        {proj  && <span className={`text-xs border px-1.5 py-0.5 rounded-full ${projectBadge(proj.id)}`}>{proj.name}</span>}
                        {anken && <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded-full">{anken.name}</span>}
                        {task.assignees.map((a) => (
                          <span key={a} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{a}</span>
                        ))}
                      </div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className={`text-sm ${nameWeight} ${nameClr}`}>
                          {cardLabel && <span className={`inline-block text-[9px] font-bold text-white rounded px-1 mr-1 ${cardLabel.cls}`}>{cardLabel.t}</span>}
                          {task.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        {hasDates && (
                          <span className={`text-xs ${isOverdue ? "text-red-700" : isDueThisWeek ? "text-orange-700" : "text-gray-400"}`}>〜{task.end}</span>
                        )}
                      </div>
                      {task.progressMemo && (
                        <div className="mt-2 text-xs text-gray-400 truncate border-t border-gray-100 pt-1">
                          📝 {task.progressMemo}
                        </div>
                      )}
                    </div>
                  );
                })}
                {colTasks.length === 0 && <div className="text-center text-xs text-gray-300 py-8">タスクなし</div>}
                {canAddTask && (
                  <button onClick={() => setAddStatus(col.key)}
                    className="w-full mt-1 py-2 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-red-400 hover:text-red-500 hover:bg-white/60 transition-colors">
                    ＋ タスクを追加
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <TaskDetailPopup task={selectedTask} onClose={() => setSelectedTask(null)} onSave={handleSave} onDelete={onDelete}
        onDuplicate={onDuplicate}
        canEdit={selectedTask ? permission.canEditTask(selectedTask) : false} />
      {addStatus && (
        <NewTaskModal tasks={tasks} initialStatus={addStatus}
          onClose={() => setAddStatus(null)}
          onSave={(t) => { onSave(t); setAddStatus(null); }} />
      )}
    </div>
  );
}
