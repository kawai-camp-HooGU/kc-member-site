"use client";
import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { useMaster } from "../hooks/useMaster";
import { applyFilters } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { PROJECT_BAR_COLORS, IMPORTANCE_CONFIG, SET_LABEL } from "../lib/constants";
import { daysBetween } from "../lib/dateUtils";
import type { Task, Project } from "../lib/models";
import { SettingsPopover } from "../components/common/SettingsPopover";
import { FilterBar } from "../components/common/FilterBar";
import { ColorRulePopover } from "../components/common/ColorRulePopover";
import { TaskDetailPopup } from "../components/task/TaskDetailPopup";
import { NewTaskModal } from "../components/task/NewTaskModal";

const CAL_PROJECT_COLORS = PROJECT_BAR_COLORS;

export interface CalendarViewProps {
  tasks: Task[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
}

interface Seg { task: Task; sCol: number; span: number; lane: number; }
interface Week { days: Date[]; segs: Seg[]; laneCount: number; }

export function CalendarView({ tasks, filters, onFiltersChange, onSave, onDelete, onDuplicate }: CalendarViewProps) {
  const { projects, permission } = useMaster();
  // 運営（管理者/オペレーター）のみ「全体」表示可。個々のメンバー/外部は自分のみに固定。
  const isOps = permission.role === "admin" || permission.role === "leader";
  const [scope, setScope]       = useState<"all" | "mine">(isOps ? "all" : "mine");
  const effectiveScope: "all" | "mine" = isOps ? scope : "mine";
  const [selected, setSelected] = useState<Task | null>(null);
  const [addDate, setAddDate]   = useState<string | null>(null);
  const [cursor, setCursor]     = useState<Date>(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = ymd(new Date());

  const visible = applyFilters(tasks.filter((t) => permission.canViewProject(t.projectId)), filters)
    .filter((t) => t.start && t.end)
    .filter((t) => effectiveScope === "all" || t.assignees.includes(permission.myName));

  const soloProject: Project | null = (() => {
    const ids = new Set(visible.map((t) => t.projectId));
    return ids.size === 1 ? (projects.find((p) => p.id === [...ids][0]) ?? null) : null;
  })();
  const cpByDate: Record<string, string> = {};
  let dueDateStr: string | null = null;
  if (soloProject) {
    const nums = ["①", "②", "③"];
    const sp = soloProject as unknown as Record<string, string>;
    [1, 2, 3].forEach((n) => {
      const d = sp[`checkpoint${n}Date`];
      if (d) cpByDate[d] = `${nums[n - 1]} ${sp[`checkpoint${n}Name`] || ""}`.trim();
    });
    if (soloProject.dueDate) dueDateStr = soloProject.dueDate;
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((first.getDay() + daysInMonth) / 7);

  const weeks: Week[] = [];
  for (let w = 0; w < weekCount; w++) {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) { const d = new Date(gridStart); d.setDate(gridStart.getDate() + w * 7 + i); days.push(d); }
    const weekStart = ymd(days[0]);
    const weekEnd   = ymd(days[6]);
    const segs: Seg[] = visible
      .filter((t) => t.start <= weekEnd && t.end >= weekStart)
      .map((t) => {
        const sCol = Math.max(0, daysBetween(weekStart, t.start));
        const eCol = Math.min(6, daysBetween(weekStart, t.end));
        return { task: t, sCol, span: eCol - sCol + 1, lane: 0 };
      })
      .sort((a, b) => a.sCol - b.sCol || b.span - a.span);
    const lanes: { sCol: number; eCol: number }[][] = [];
    segs.forEach((seg) => {
      const eCol = seg.sCol + seg.span - 1;
      let lane = lanes.findIndex((L) => L.every((x) => eCol < x.sCol || seg.sCol > x.eCol));
      if (lane === -1) { lane = lanes.length; lanes.push([]); }
      lanes[lane].push({ sCol: seg.sCol, eCol });
      seg.lane = lane;
    });
    weeks.push({ days, segs, laneCount: Math.max(lanes.length, 1) });
  }

  const NAVBTN = "w-7 h-7 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:border-red-400";

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [stickyTops, setStickyTops] = useState({ bar: 0, week: 0 });
  useEffect(() => {
    const compute = () => {
      const tabsEl = document.querySelector("[data-viewtabs]");
      const tabsH  = tabsEl ? Math.round(tabsEl.getBoundingClientRect().height) : 0;
      const barH   = toolbarRef.current ? Math.round(toolbarRef.current.getBoundingClientRect().height) : 0;
      setStickyTops({ bar: tabsH, week: tabsH + barH });
    };
    compute();
    const id = setTimeout(compute, 0);
    window.addEventListener("resize", compute);
    return () => { clearTimeout(id); window.removeEventListener("resize", compute); };
  }, []);

  const scopeOptions = [{ key: "all", label: "全体" }, { key: "mine", label: "自分のみ" }] as const;

  return (
    <div className="space-y-4">
      <div ref={toolbarRef} className="flex items-center gap-3 flex-wrap sticky z-40 bg-gray-50 -mx-4 px-4 py-1.5" style={{ top: stickyTops.bar }}>
        <SettingsPopover>
          <div>
            <div className={SET_LABEL}>抽出条件</div>
            <FilterBar filters={filters} onChange={onFiltersChange} />
          </div>
        </SettingsPopover>
        <ColorRulePopover variant="calendar" />
        <div className="flex items-center gap-2 ml-1">
          <button className={NAVBTN} onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button>
          <span className="text-base font-semibold text-gray-800 w-28 text-center">{year}年{month + 1}月</span>
          <button className={NAVBTN} onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button>
        </div>
        <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 hover:border-red-400">今日</button>
        {isOps ? (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-auto">
            {scopeOptions.map((s) => (
              <button key={s.key} onClick={() => setScope(s.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${scope === s.key ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {s.key === "mine" ? `👤 ${s.label}` : s.label}
              </button>
            ))}
          </div>
        ) : <div className="ml-auto" />}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="grid grid-cols-7 sticky z-30 bg-white rounded-t-xl border-b border-gray-100" style={{ top: stickyTops.week }}>
          {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
            <div key={w} className={`text-xs text-center py-1.5 ${i === 0 ? "text-red-400" : i === 6 ? "text-red-400" : "text-gray-400"}`}>{w}</div>
          ))}
        </div>
        {weeks.map((wk, wi) => (
          <div key={wi} className="relative border-b border-gray-100 last:border-b-0" style={{ minHeight: 28 + wk.laneCount * 20 + 6 }}>
            <div className="grid grid-cols-7 absolute inset-0">
              {wk.days.map((d, di) => {
                const ds = ymd(d);
                const inMonth = d.getMonth() === month;
                const isToday = ds === todayStr;
                const isDue = ds === dueDateStr;
                const cpLabel = !isDue ? cpByDate[ds] : null;
                const frameStyle: CSSProperties | undefined = isDue
                  ? { background: "#fef2f2", boxShadow: "inset 0 0 0 2px #ef4444" }
                  : cpLabel
                    ? { background: "#faf5ff", boxShadow: "inset 0 0 0 2px #7c3aed" }
                    : undefined;
                return (
                  <div key={di} onClick={() => setAddDate(ds)}
                    title="クリックで新規タスク登録"
                    className={`relative border-r border-gray-100 last:border-r-0 px-1 pt-1 cursor-pointer transition-colors ${!frameStyle ? "hover:bg-blue-50" : ""} ${inMonth && !frameStyle ? "" : !inMonth ? "bg-gray-50" : ""}`} style={frameStyle}>
                    <span className={`text-xs inline-flex items-center justify-center ${isToday ? "bg-red-500 text-white rounded-full w-5 h-5" : !inMonth ? "text-gray-300" : di === 0 ? "text-red-400" : di === 6 ? "text-red-400" : "text-gray-600"}`}>{d.getDate()}</span>
                    {isDue && (
                      <span className="absolute right-0.5 top-0.5 text-[9px] text-white bg-red-500 rounded px-1 max-w-[80%] truncate z-20">🚩 期限</span>
                    )}
                    {cpLabel && (
                      <span className="absolute right-0.5 top-0.5 text-[9px] text-white bg-violet-600 rounded px-1 max-w-[80%] truncate z-20">{cpLabel}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {wk.segs.map((seg, si) => {
              const t = seg.task;
              const isCompleted   = t.status === "completed";
              const isOverdue     = !isCompleted && t.end < todayStr;
              const isDueThisWeek = !isCompleted && !isOverdue && daysBetween(todayStr, t.end) <= 7;
              const impKey = (t.importance && t.importance !== "none") ? t.importance : null;
              const labels: { t: string; cls: string }[] = [];
              if (impKey)            labels.push({ t: IMPORTANCE_CONFIG[impKey].icon, cls: IMPORTANCE_CONFIG[impKey].solid });
              if (isOverdue)         labels.push({ t: "超過", cls: "bg-red-600 text-white" });
              else if (isDueThisWeek) labels.push({ t: "今週", cls: "bg-orange-500 text-white" });
              const barColor = isCompleted ? "bg-gray-400" : CAL_PROJECT_COLORS[(t.projectId - 1) % CAL_PROJECT_COLORS.length];
              return (
                <div key={si} onClick={() => setSelected(t)}
                  title={t.name}
                  className={`absolute flex items-center gap-0.5 text-white text-[10px] leading-none rounded px-1 py-1 cursor-pointer overflow-hidden hover:opacity-80 transition-opacity z-10 ${barColor}`}
                  style={{ left: `calc(${(seg.sCol / 7) * 100}% + 2px)`, width: `calc(${(seg.span / 7) * 100}% - 4px)`, top: 26 + seg.lane * 20 }}>
                  {labels.map((l, i) => (
                    <span key={i} className={`shrink-0 font-bold rounded px-0.5 ${l.cls}`} style={{ fontSize: "8px" }}>{l.t}</span>
                  ))}
                  <span className={`truncate min-w-0 ${isCompleted ? "line-through" : ""}`}>{t.name}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <TaskDetailPopup task={selected} onClose={() => setSelected(null)}
        onSave={(u) => { onSave(u); setSelected(u); }}
        onDelete={(id) => { onDelete(id); setSelected(null); }}
        onDuplicate={onDuplicate}
        canEdit={selected ? permission.canEditTask(selected) : false} />

      {addDate && (
        <NewTaskModal tasks={tasks} initialDate={addDate}
          onClose={() => setAddDate(null)} onSave={onSave} />
      )}
    </div>
  );
}
