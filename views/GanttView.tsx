"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent, UIEvent as ReactUIEvent } from "react";
import { useMaster } from "../hooks/useMaster";
import { applyFilters } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { SET_LABEL, SET_SECTION, setChip, IMPORTANCE_CONFIG, STATUS_CONFIG, projectBadge, projectBar } from "../lib/constants";
import { daysBetween, addDays } from "../lib/dateUtils";
import { gridCellNav } from "../lib/gridNav";
import {
  COL_W_DEFAULT, COL_W_MIN, COL_W_MAX, ROW_H_DEFAULT, ROW_H_MIN, ROW_H_MAX,
  monthStart, addMonths, addYearsStr, GANTT_COLUMN_GROUPS,
} from "../components/gantt/ganttConfig";
import { GanttHeader } from "../components/gantt/GanttHeader";
import { GridAssigneeCell } from "../components/gantt/GridAssigneeCell";
import { GridDateCell } from "../components/gantt/GridDateCell";
import { FilterBar } from "../components/common/FilterBar";
import { ColorRulePopover } from "../components/common/ColorRulePopover";
import { TaskDetailPopup } from "../components/task/TaskDetailPopup";
import { NewTaskModal } from "../components/task/NewTaskModal";
import type { Task, Project } from "../lib/models";

export interface GanttViewProps {
  tasks: Task[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
  hideProjectCol?: boolean;
  onOpenBulk?: () => void;
}

interface UndoEntry { id: number; field: string; prev: unknown; }
const focusClosestRow = (el: Element | null) => (el?.closest("[data-grow]") as HTMLElement | null)?.focus();

export function GanttView({ tasks, filters, onFiltersChange, onSave, onDelete, onDuplicate, hideProjectCol = false, onOpenBulk }: GanttViewProps) {
  const { projects, anken: ankenList, members, permission } = useMaster();
  const [selected, setSelected]       = useState<Task | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [assigneeClip, setAssigneeClip] = useState<string[] | null>(null);
  const [dateClip, setDateClip]         = useState<string | null>(null);
  const editUndo = useRef<UndoEntry[]>([]);
  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const applyField = useCallback((t: Task, field: string, value: unknown) => {
    editUndo.current.push({ id: t.id, field, prev: (t as unknown as Record<string, unknown>)[field] ?? (field === "assignees" ? [] : "") });
    if (editUndo.current.length > 200) editUndo.current.shift();
    onSave({ ...t, [field]: value } as Task);
  }, [onSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
        const last = editUndo.current.pop();
        if (!last) return;
        e.preventDefault();
        const t = tasksRef.current.find((x) => x.id === last.id);
        if (t) onSave({ ...t, [last.field]: last.prev } as Task);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  const [chartStart, setChartStart]   = useState<string>(() => monthStart());
  const [chartEnd,   setChartEnd]     = useState<string>(() => addMonths(monthStart(), 3));
  const [colW, setColW]               = useState(COL_W_DEFAULT);
  const [rowH, setRowH]               = useState(ROW_H_DEFAULT);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const topBarRef  = useRef<HTMLDivElement>(null);
  const pinchRef   = useRef<number | null>(null);

  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(
    new Set(hideProjectCol ? ["projectName", "ankenName", "schedule"] : ["ankenName", "schedule"])
  );
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => { if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  const colWMap = useMemo(() => {
    const m: Record<string, number> = {};
    GANTT_COLUMN_GROUPS.forEach((g) => g.columns.forEach((c) => { m[c.key] = colWidths[c.key] ?? c.width; }));
    return m;
  }, [colWidths]);

  const handleColResizeMouseDown = (colKey: string, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWMap[colKey];
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(40, startW + ev.clientX - startX);
      setColWidths((prev) => ({ ...prev, [colKey]: newW }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const clampColW = (v: number) => Math.min(COL_W_MAX, Math.max(COL_W_MIN, Math.round(v)));
  const clampRowH = (v: number) => Math.min(ROW_H_MAX, Math.max(ROW_H_MIN, Math.round(v)));

  const toggleGroup = (key: string) => setHiddenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const leftW = GANTT_COLUMN_GROUPS.reduce((sum, g) =>
    hiddenGroups.has(g.key) ? sum : sum + g.columns.reduce((s, c) => s + (colWMap[c.key] ?? c.width), 0), 0);
  const fontSize  = Math.max(8,  Math.round(rowH * 14 / ROW_H_DEFAULT));
  const badgeSz   = Math.max(7,  Math.round(rowH * 11 / ROW_H_DEFAULT));
  const barH      = Math.max(6,  Math.round(rowH * 28 / ROW_H_DEFAULT));
  const barTop    = Math.max(2,  Math.round((rowH - barH) / 2));

  const zoomBy = (factor: number) => {
    setColW((prev) => clampColW(prev * factor));
    setRowH((prev) => clampRowH(prev * factor));
  };

  const onScrollBody = (e: ReactUIEvent<HTMLDivElement>) => { if (topBarRef.current) topBarRef.current.scrollLeft = e.currentTarget.scrollLeft; };
  const onScrollTop  = (e: ReactUIEvent<HTMLDivElement>) => { if (scrollRef.current) scrollRef.current.scrollLeft  = e.currentTarget.scrollLeft; };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = Math.hypot(dx, dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchRef.current === null) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      zoomBy(dist / pinchRef.current);
      pinchRef.current = dist;
    };
    const onTouchEnd = () => { pinchRef.current = null; };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, []);

  const [sortKey, setSortKey]   = useState<string>("default");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");

  const totalDays = Math.max(daysBetween(chartStart, chartEnd) + 1, 1);
  const todayOff  = daysBetween(chartStart, new Date().toISOString().slice(0, 10));

  const filtered = applyFilters(tasks.filter((t) => permission.canViewProject(t.projectId) && (scope === "all" || t.assignees.includes(permission.myName))), filters).slice().sort((a, b) => {
    const cmp = (va: string, vb: string) => va < vb ? -1 : va > vb ? 1 : 0;
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "default") {
      const pa = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const pb = projects.find((p) => p.id === b.projectId)?.name ?? "";
      if (pa !== pb) return cmp(pa, pb);
      const aa = ankenList.find((x) => x.id === a.ankenId)?.name ?? "";
      const ab = ankenList.find((x) => x.id === b.ankenId)?.name ?? "";
      if (aa !== ab) return cmp(aa, ab);
      return cmp(a.end, b.end);
    }
    if (sortKey === "end")      return cmp(a.end, b.end) * dir;
    if (sortKey === "assignee") return cmp(a.assignees[0] ?? "", b.assignees[0] ?? "") * dir;
    return 0;
  });

  const soloProject: Project | null = (() => {
    const ids = new Set(filtered.map((t) => t.projectId));
    if (ids.size !== 1) return null;
    return projects.find((x) => x.id === [...ids][0]) ?? null;
  })();

  const checkpointLines = (() => {
    if (!soloProject) return [];
    const nums = ["①", "②", "③"];
    const sp = soloProject as unknown as Record<string, string>;
    return [1, 2, 3]
      .map((n) => ({ num: nums[n - 1], name: sp[`checkpoint${n}Name`] || "", date: sp[`checkpoint${n}Date`] || "" }))
      .filter((cp) => cp.date)
      .map((cp) => ({ ...cp, off: daysBetween(chartStart, cp.date) }))
      .filter((cp) => cp.off >= 0 && cp.off <= totalDays);
  })();

  const dueLine = (() => {
    if (!soloProject || !soloProject.dueDate) return null;
    const off = daysBetween(chartStart, soloProject.dueDate);
    if (off < 0 || off > totalDays) return null;
    return { off, date: soloProject.dueDate };
  })();

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const resetSort = () => { setSortKey("default"); setSortDir("asc"); };

  const handleSave = (updated: Task) => { onSave(updated); setSelected(updated); };

  const onChangeStart = (val: string) => {
    setChartStart(val);
    if (val >= chartEnd) setChartEnd(addMonths(val, 3));
    if (chartEnd > addYearsStr(val, 3)) setChartEnd(addYearsStr(val, 3));
  };
  const onChangeEnd = (val: string) => {
    setChartEnd(val);
    if (val <= chartStart) setChartStart(addMonths(val, -3));
    if (chartStart < addYearsStr(val, -3)) setChartStart(addYearsStr(val, -3));
  };

  const DATE_CLS = "text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-red-400 cursor-pointer";
  const presets: { label: string; end: (s: string) => string }[] = [
    { label: "1週間", end: (s) => addDays(s, 7) },
    { label: "1ヶ月", end: (s) => addMonths(s, 1) },
    { label: "6カ月", end: (s) => addMonths(s, 6) },
    { label: "1年間", end: (s) => addMonths(s, 12) },
  ];
  const sortButtons = [{ key: "end", label: "締切日" }, { key: "assignee", label: "メンバー" }];
  const scopeOptions = [{ key: "all", label: "全体" }, { key: "mine", label: "自分のみ" }] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        <div className="relative" ref={settingsRef}>
          <button onClick={() => setSettingsOpen((o) => !o)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border transition-colors ${
              settingsOpen ? "border-red-400 bg-blue-50 text-red-600" : "border-gray-300 bg-white text-gray-600 hover:border-red-400"
            }`}>
            ⚙ 表示設定 <span className="text-[10px]">{settingsOpen ? "▲" : "▼"}</span>
          </button>

          {settingsOpen && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSettingsOpen(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="font-bold text-gray-800">表示設定</h2>
                  <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-3">
              <div>
                <div className={SET_LABEL}>表示期間</div>
                <div className="grid gap-2 items-center mb-2" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
                  <input type="date" value={chartStart} min={addYearsStr(chartEnd, -3)} max={chartEnd}
                    onChange={(e) => onChangeStart(e.target.value)} className={`${DATE_CLS} w-full`} />
                  <span className="text-xs text-gray-400 text-center">〜</span>
                  <input type="date" value={chartEnd} min={chartStart} max={addYearsStr(chartStart, 3)}
                    onChange={(e) => onChangeEnd(e.target.value)} className={`${DATE_CLS} w-full`} />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {presets.map((p) => (
                    <button key={p.label}
                      onClick={() => { const s = monthStart(); setChartStart(s); setChartEnd(p.end(s)); }}
                      className={`text-center ${setChip(false)}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => { const s = monthStart(); setChartStart(s); setChartEnd(addMonths(s, 3)); }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline mt-2 ml-auto block">
                  初期値に戻す
                </button>
              </div>

              <div className={SET_SECTION}>
                <div className={SET_LABEL}>抽出条件</div>
                <FilterBar filters={filters} onChange={onFiltersChange} />
              </div>

              <div className={SET_SECTION}>
                <div className={SET_LABEL}>並び替え</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button onClick={resetSort} className={`text-center ${setChip(sortKey === "default")}`}>
                    初期値
                  </button>
                  {sortButtons.map(({ key, label }) => {
                    const active = sortKey === key;
                    return (
                      <button key={key} onClick={() => toggleSort(key)}
                        className={`flex items-center justify-center gap-0.5 ${setChip(active)}`}>
                        {label}
                        <span className="ml-0.5">{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={SET_SECTION}>
                <div className="flex items-center justify-between mb-2">
                  <div className={SET_LABEL + " mb-0"}>表示列</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setHiddenGroups(new Set())}
                      className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">全選択</button>
                    <button onClick={() => setHiddenGroups(new Set(GANTT_COLUMN_GROUPS.map((g) => g.key)))}
                      className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">全解除</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {GANTT_COLUMN_GROUPS.map((group) => {
                    const isVisible = !hiddenGroups.has(group.key);
                    return (
                      <button key={group.key} onClick={() => toggleGroup(group.key)}
                        className={`text-center whitespace-nowrap ${setChip(isVisible)}`}>
                        {group.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={SET_SECTION}>
                <div className={SET_LABEL}>ズーム</div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => zoomBy(0.8)}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:border-red-300 text-sm leading-none">−</button>
                  <span className="text-xs text-gray-600 w-12 text-center">{Math.round(colW / COL_W_DEFAULT * 100)}%</span>
                  <button onClick={() => zoomBy(1.25)}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:border-red-300 text-sm leading-none">＋</button>
                  <button onClick={() => { setColW(COL_W_DEFAULT); setRowH(ROW_H_DEFAULT); setColWidths({}); }}
                    className={`ml-1 ${setChip(false)}`}>リセット</button>
                </div>
              </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <ColorRulePopover />

        <span className="text-xs text-gray-500 whitespace-nowrap">表示期間：{chartStart} 〜 {chartEnd}（{totalDays}日間）</span>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-auto">
          {scopeOptions.map((s) => (
            <button key={s.key} onClick={() => setScope(s.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${scope === s.key ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {s.key === "mine" ? `👤 ${s.label}` : s.label}
            </button>
          ))}
        </div>

        {["admin", "leader", "member"].includes(permission.role) && (
          <div className="flex items-center gap-2 shrink-0">
            {onOpenBulk && (
              <button onClick={onOpenBulk}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-red-600 text-red-600 text-sm font-medium hover:bg-blue-50 transition-colors whitespace-nowrap">
                ▤ 一括登録
              </button>
            )}
            <button onClick={() => setNewTaskOpen(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors whitespace-nowrap">
              ＋ 新規タスク
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div ref={topBarRef} onScroll={onScrollTop}
          style={{ overflowX: "auto", overflowY: "hidden", height: 14 }}
          className="border-b border-gray-100">
          <div style={{ width: leftW + totalDays * colW, height: 1 }} />
        </div>

        <div ref={scrollRef} onScroll={onScrollBody}
          style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 240px)" }}>
          <div style={{ minWidth: leftW + totalDays * colW }}>
            <div style={{ position: "sticky", top: 0, zIndex: 20 }}>
              <div className="flex border-b border-gray-600 bg-gray-700">
                <div className="flex shrink-0 border-r border-gray-600" style={{ position: "sticky", left: 0, zIndex: 21, background: "#374151" }}>
                  {GANTT_COLUMN_GROUPS.map((group) => {
                    const hidden = hiddenGroups.has(group.key);
                    const w = hidden ? 0 : group.columns.reduce((s, c) => s + (colWMap[c.key] ?? c.width), 0);
                    if (w === 0) return null;
                    return (
                      <div key={group.key}
                        className="text-xs font-semibold text-white px-2 py-1 border-r border-gray-600 cursor-pointer hover:bg-gray-600 select-none whitespace-nowrap overflow-hidden"
                        style={{ width: w }} onClick={() => toggleGroup(group.key)}>
                        ▾ {group.label}
                      </div>
                    );
                  })}
                </div>
                <div className="px-2 py-1 text-xs text-gray-300" style={{ width: totalDays * colW }}>スケジュール</div>
              </div>
              <div className="flex border-b border-gray-500 bg-gray-600">
                <div className="flex shrink-0 border-r border-gray-500" style={{ position: "sticky", left: 0, zIndex: 21, background: "#4b5563" }}>
                  {GANTT_COLUMN_GROUPS.map((group) =>
                    group.columns.map((col) => {
                      const w = hiddenGroups.has(group.key) ? 0 : (colWMap[col.key] ?? col.width);
                      if (w === 0) return null;
                      return (
                        <div key={col.key}
                          className="relative px-2 py-1.5 text-xs font-semibold text-white border-r border-gray-500 shrink-0 select-none"
                          style={{ width: w }}>
                          {col.label}
                          <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-red-400 hover:opacity-70 z-10"
                            onMouseDown={(e) => handleColResizeMouseDown(col.key, e)} />
                        </div>
                      );
                    })
                  )}
                </div>
                <GanttHeader chartStart={chartStart} totalDays={totalDays} colW={colW} checkpoints={checkpointLines} dueLine={dueLine} />
              </div>
            </div>

            {filtered.map((task) => {
              const hasDates  = !!(task.start && task.end);
              const offStart  = daysBetween(chartStart, task.start);
              const offWidth  = daysBetween(task.start, task.end) + 1;
              const proj      = projects.find((p) => p.id === task.projectId);
              const anken     = ankenList.find((a) => a.id === task.ankenId);
              const todayStr  = new Date().toISOString().slice(0, 10);
              const daysLeft  = hasDates ? daysBetween(todayStr, task.end) : Infinity;
              const isCompleted   = task.status === "completed";
              const isOverdue     = hasDates && !isCompleted && task.end < todayStr;
              const isDueThisWeek = hasDates && !isCompleted && !isOverdue && daysLeft <= 7;
              const isNoDate      = !hasDates && !isCompleted;

              const isImpIII = task.importance === 3;
              const rowBg  = isCompleted   ? "#edeef0"
                           : isOverdue     ? "repeating-linear-gradient(45deg, #fde4e4, #fde4e4 6px, #f7cccc 6px, #f7cccc 12px)"
                           : isDueThisWeek ? "#ffe8cc"
                           : isImpIII      ? "#fff0f0"
                           : "#ffffff";
              const rowBorderLeft = isOverdue     ? "4px solid #dc2626"
                                  : isDueThisWeek ? "4px solid #f97316"
                                  : undefined;
              const rowLabel = isOverdue     ? { t: "超過",     cls: "bg-red-600"   }
                             : isDueThisWeek ? { t: "今週期限", cls: "bg-orange-500" }
                             : isNoDate      ? { t: "日付なし", cls: "bg-gray-400"  }
                             : null;
              const projBadgeCls = projectBadge(task.projectId);
              const barCls = isCompleted ? "bg-gray-400" : projectBar(task.projectId);
              const imp        = (task.importance && task.importance !== "none") ? task.importance : null;
              const impColor   = imp ? IMPORTANCE_CONFIG[imp].ganttText : null;
              const impBold    = imp === 3;
              const nameWeight = impBold ? "font-bold" : imp ? "font-medium" : "font-normal";
              const nameColor  = isCompleted ? "text-gray-400" : (impColor || "text-gray-800");
              const nameStrike = isCompleted ? "line-through" : "";
              const subColor   = isCompleted ? "text-gray-400" : (impColor || "text-gray-500");
              const subBold    = impBold && !isCompleted ? "font-bold" : "";
              const canEditRow = permission.canEditTask(task);

              return (
                <div key={task.id} className="flex border-b border-gray-100 cursor-pointer transition-colors"
                  style={{ minHeight: rowH, background: rowBg, borderLeft: rowBorderLeft }}
                  onClick={() => setSelected(task)}>
                  <div className="flex shrink-0 border-r border-gray-100 overflow-hidden"
                    style={{ position: "sticky", left: 0, zIndex: 10, background: rowBg }}>
                    {!hiddenGroups.has("projectName") && (
                      <div className="flex items-center px-2 overflow-hidden border-r border-gray-100 shrink-0" style={{ width: colWMap.projectName, minHeight: rowH }}>
                        {proj && <span className={`text-xs border px-1 rounded truncate ${projBadgeCls}`} style={{ fontSize: badgeSz }}>{proj.name}</span>}
                      </div>
                    )}
                    {!hiddenGroups.has("ankenName") && (
                      <div className="flex items-center px-2 overflow-hidden border-r border-gray-100 shrink-0" style={{ width: colWMap.ankenName, minHeight: rowH }}>
                        <span className="text-xs text-purple-600 truncate" style={{ fontSize: badgeSz }}>{anken?.name ?? ""}</span>
                      </div>
                    )}
                    {!hiddenGroups.has("importance") && (
                      <div className="flex items-center px-1.5 overflow-hidden border-r border-gray-100 shrink-0 outline-none focus:ring-2 focus:ring-inset focus:ring-red-400" style={{ width: colWMap.importance, minHeight: rowH }}
                        tabIndex={canEditRow ? 0 : undefined} data-grow={task.id} data-gcol="importance"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (!canEditRow || e.target !== e.currentTarget) return; if (gridCellNav(e, task.id, "importance")) return; if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.currentTarget.querySelector("select")?.focus(); } }}>
                        <select tabIndex={-1} value={String(task.importance ?? "none")} disabled={!canEditRow}
                          onChange={(e) => { if (canEditRow) { const v = e.target.value; applyField(task, "importance", v === "none" ? "none" : Number(v)); } }}
                          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); focusClosestRow(e.currentTarget); } }}
                          className={`w-full text-center rounded-full font-bold border-0 outline-none appearance-none ${canEditRow ? "cursor-pointer" : "cursor-default opacity-70"} ${IMPORTANCE_CONFIG[task.importance ?? "none"]?.chip ?? "bg-gray-100 text-gray-400"}`}
                          style={{ fontSize: badgeSz, padding: "2px 4px" }}>
                          {Object.entries(IMPORTANCE_CONFIG).map(([k, v]) => (
                            <option key={k} value={k}>{v.icon || "-"}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {!hiddenGroups.has("taskName") && (
                      <div className="flex items-center gap-1.5 px-2 overflow-hidden border-r border-gray-100 shrink-0 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-red-400" style={{ width: colWMap.taskName, minHeight: rowH }}
                        tabIndex={canEditRow ? 0 : undefined} data-grow={task.id} data-gcol="taskName"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (!canEditRow || e.target !== e.currentTarget) return; if (gridCellNav(e, task.id, "taskName")) return; if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.currentTarget.querySelector("input")?.focus(); } }}>
                        {rowLabel && (
                          <span className={`shrink-0 text-white font-bold rounded px-1 leading-none ${rowLabel.cls}`} style={{ fontSize: Math.max(8, badgeSz - 2) }}>{rowLabel.t}</span>
                        )}
                        <input type="text" tabIndex={-1} defaultValue={task.name} key={task.id + "-name"} readOnly={!canEditRow}
                          onBlur={(e) => { if (canEditRow && e.target.value.trim() && e.target.value !== task.name) applyField(task, "name", e.target.value.trim()); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusClosestRow(e.currentTarget); } if (e.key === "Escape") { e.currentTarget.value = task.name; focusClosestRow(e.currentTarget); } }}
                          className={`flex-1 min-w-0 bg-transparent border-0 outline-none ${nameWeight} ${nameStrike} truncate ${canEditRow ? "focus:bg-white focus:border focus:border-red-300 focus:rounded" : "cursor-default"} px-0.5 ${nameColor}`}
                          style={{ fontSize }} />
                      </div>
                    )}
                    {!hiddenGroups.has("assignees") && (
                      <GridAssigneeCell task={task}
                        members={members.filter((m) => !m.isDeleted && (proj?.memberNames ?? []).includes(m.name))}
                        canEdit={canEditRow}
                        onChange={(t, next) => applyField(t, "assignees", next)}
                        clip={assigneeClip} setClip={setAssigneeClip}
                        width={colWMap.assignees} rowH={rowH} badgeSz={badgeSz} subColor={subColor} subBold={subBold} />
                    )}
                    {!hiddenGroups.has("status") && (
                      <div className="flex items-center px-1.5 overflow-hidden border-r border-gray-100 shrink-0 outline-none focus:ring-2 focus:ring-inset focus:ring-red-400" style={{ width: colWMap.status, minHeight: rowH }}
                        tabIndex={canEditRow ? 0 : undefined} data-grow={task.id} data-gcol="status"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (!canEditRow || e.target !== e.currentTarget) return; if (gridCellNav(e, task.id, "status")) return; if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.currentTarget.querySelector("select")?.focus(); } }}>
                        <select tabIndex={-1} value={task.status} disabled={!canEditRow}
                          onChange={(e) => { if (canEditRow) applyField(task, "status", e.target.value); }}
                          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); focusClosestRow(e.currentTarget); } }}
                          className={`w-full text-center rounded-full font-medium border-0 outline-none appearance-none ${canEditRow ? "cursor-pointer" : "cursor-default opacity-70"} ${
                            task.status === "completed"   ? "bg-neutral-200 text-neutral-700" :
                            task.status === "in_progress" ? "bg-green-100 text-green-700" :
                            "bg-gray-100 text-gray-500"}`}
                          style={{ fontSize: badgeSz, padding: "2px 4px" }}>
                          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {!hiddenGroups.has("schedule") && (
                      <GridDateCell task={task} field="start" value={task.start} canEdit={canEditRow}
                        onChange={applyField} clip={dateClip} setClip={setDateClip}
                        width={colWMap.startDate} rowH={rowH} badgeSz={badgeSz} textCls={`${subColor} ${subBold}`} />
                    )}
                    {!hiddenGroups.has("schedule") && (
                      <GridDateCell task={task} field="end" value={task.end} canEdit={canEditRow}
                        onChange={applyField} clip={dateClip} setClip={setDateClip}
                        width={colWMap.endDate} rowH={rowH} badgeSz={badgeSz}
                        textCls={isOverdue ? "text-red-500 font-medium" : `${subColor} ${subBold}`} />
                    )}
                  </div>
                  <div className="relative flex-1 overflow-hidden" style={{ width: totalDays * colW }}>
                    {Array.from({ length: Math.ceil(totalDays / 7) }).map((_, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: i * 7 * colW }} />
                    ))}
                    {dueLine && (
                      <div className="absolute top-0 bottom-0 z-10" style={{ left: dueLine.off * colW, borderLeft: "2px dotted #ef4444" }} />
                    )}
                    {checkpointLines.map((cp) => (
                      <div key={cp.num} className="absolute top-0 bottom-0 z-10" style={{ left: cp.off * colW, borderLeft: "2px dashed #7c3aed" }} />
                    ))}
                    {todayOff >= 0 && todayOff <= totalDays && (
                      <div className="absolute top-0 bottom-0 w-px bg-red-300 z-10" style={{ left: todayOff * colW }} />
                    )}
                    {hasDates && (
                      <div className={`absolute rounded-sm cursor-pointer flex items-center px-1 ${barCls} hover:opacity-80 transition-opacity`}
                        style={{ top: barTop, height: barH, left: offStart * colW, width: Math.max(offWidth * colW - 2, 4) }}>
                        {barH >= 14 && <span className={`text-white font-medium truncate ${isCompleted ? "line-through" : ""}`} style={{ fontSize: Math.max(7, badgeSz - 1) }}>{task.name}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="py-12 text-center text-gray-400 text-sm">該当するタスクがありません</div>}
          </div>
        </div>
      </div>

      <TaskDetailPopup task={selected} onClose={() => setSelected(null)} onSave={handleSave} onDelete={onDelete}
        onDuplicate={onDuplicate}
        canEdit={selected ? permission.canEditTask(selected) : false} />
      {newTaskOpen && <NewTaskModal tasks={tasks} onClose={() => setNewTaskOpen(false)} onSave={onSave} />}
    </div>
  );
}
