"use client";
// ============================================================
// カレンダー
//   3つのレイヤを重ねて表示する。
//     ① タスク         … プロジェクト色のバー（従来どおり）
//     ② イベント・予定 … ●つきチップ／複数日は帯（events）
//     ③ フォーム締切   … ▤つきチップ（forms.show_on_calendar もしくはイベントに紐付いたフォーム）
//   レイヤはツールバーの3ボタンで個別にON/OFFできる。
// ============================================================
import { useState, useRef, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useMaster } from "../hooks/useMaster";
import { useRoute } from "../hooks/useRoute";
import { applyFilters } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { PROJECT_BAR_COLORS, IMPORTANCE_CONFIG, SET_LABEL } from "../lib/constants";
import { daysBetween } from "../lib/dateUtils";
import type { Task, Project, CalEvent } from "../lib/models";
import { SettingsPopover } from "../components/common/SettingsPopover";
import { FilterBar } from "../components/common/FilterBar";
import { ColorRulePopover } from "../components/common/ColorRulePopover";
import { TaskDetailPopup } from "../components/task/TaskDetailPopup";
import { NewTaskModal } from "../components/task/NewTaskModal";
import { EventDetailPopup } from "../components/event/EventDetailPopup";
import { EventEditModal } from "../components/event/EventEditModal";
import {
  fetchEvents, fetchFormBriefs, fetchAnsweredMembers, buildFormDeadlines,
  visibleEvents, emptyEvent, dayKey,
} from "../lib/events";
import type { FormBrief, FormDeadline } from "../lib/events";
import { loadAttributeTree } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrNode } from "../lib/attributes";

const CAL_PROJECT_COLORS = PROJECT_BAR_COLORS;

export interface CalendarViewProps {
  tasks: Task[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
}

type CalItem =
  | { type: "event"; ev: CalEvent }
  | { type: "form";  fd: FormDeadline }
  | { type: "task";  task: Task };

interface Seg { item: CalItem; sCol: number; span: number; lane: number; }
interface Week { days: Date[]; segs: Seg[]; laneCount: number; }

const LANE_H = 20;

export function CalendarView({ tasks, filters, onFiltersChange, onSave, onDelete, onDuplicate }: CalendarViewProps) {
  const { projects, members, permission } = useMaster();
  // 運営（管理者/オペレーター）のみ「全体」表示・予定の登録が可能
  const isOps = permission.role === "admin" || permission.role === "leader";
  const [scope, setScope]       = useState<"all" | "mine">(isOps ? "all" : "mine");
  const effectiveScope: "all" | "mine" = isOps ? scope : "mine";
  const [addDate, setAddDate]   = useState<string | null>(null);

  // ── 画面状態は URL（固定URL化）──
  //    ?ym=2026-08 表示月 ・ ?task=88 タスク詳細 ・ ?event=5 イベント詳細
  const route = useRoute();
  const ymParam = route.q("ym");
  const cursor = useMemo(() => {
    if (ymParam && /^\d{4}-\d{2}$/.test(ymParam)) {
      const [y, m] = ymParam.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, [ymParam]);
  const setCursor = (d: Date) =>
    route.setQuery({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });

  const selected = tasks.find((t) => t.id === route.qNum("task")) ?? null;
  const setSelected = (t: Task | null) => route.setQuery({ task: t?.id ?? null });

  // ── レイヤ（表示するもの）──
  const [showTasks,  setShowTasks]  = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showForms,  setShowForms]  = useState(true);

  // ── イベント／フォーム ──
  const [events, setEvents]   = useState<CalEvent[]>([]);
  const [forms, setForms]     = useState<FormBrief[]>([]);
  const [answered, setAnswered] = useState<Map<number, Set<number>>>(new Map());
  const [tree, setTree]       = useState<AttrNode[]>([]);
  const [evEdit, setEvEdit]   = useState<CalEvent | null>(null);
  const evSel = events.find((e) => e.id === route.qNum("event")) ?? null;
  const setEvSel = (e: CalEvent | null) => route.setQuery({ event: e?.id ?? null });

  const index  = useMemo(() => buildAttrIndex(tree), [tree]);
  const myAttrs = useMemo(
    () => members.find((m) => m.id === permission.myId)?.attrIds ?? [],
    [members, permission.myId],
  );

  const reloadEvents = async () => {
    const [e, f, a] = await Promise.all([fetchEvents(), fetchFormBriefs(), fetchAnsweredMembers()]);
    setEvents(e); setForms(f); setAnswered(a);
  };
  useEffect(() => {
    (async () => {
      try {
        const [t] = await Promise.all([loadAttributeTree(), reloadEvents()]);
        setTree(t);
      } catch (e) { console.error("イベント読込エラー:", e); }
    })();
  }, []);

  const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = ymd(new Date());

  // ── 表示対象 ──
  const visibleTasks = applyFilters(tasks.filter((t) => permission.canViewProject(t.projectId)), filters)
    .filter((t) => t.start && t.end)
    .filter((t) => effectiveScope === "all" || t.assignees.includes(permission.myName));

  const myEvents = useMemo(
    () => visibleEvents(events, myAttrs, index, isOps),
    [events, myAttrs, index, isOps],
  );
  const deadlines = useMemo(
    () => buildFormDeadlines(forms, myEvents, answered, permission.myId),
    [forms, myEvents, answered, permission.myId],
  );

  const soloProject: Project | null = (() => {
    const ids = new Set(visibleTasks.map((t) => t.projectId));
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

  // ── 週ごとのレイアウト（イベント → フォーム締切 → タスク の順に上から積む）──
  const weeks: Week[] = [];
  for (let w = 0; w < weekCount; w++) {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) { const d = new Date(gridStart); d.setDate(gridStart.getDate() + w * 7 + i); days.push(d); }
    const weekStart = ymd(days[0]);
    const weekEnd   = ymd(days[6]);

    const raw: { item: CalItem; s: string; e: string; pri: number }[] = [];
    if (showEvents) {
      myEvents.forEach((ev) => {
        const s = dayKey(ev.startAt);
        const e = dayKey(ev.endAt || ev.startAt) || s;
        if (s <= weekEnd && e >= weekStart) raw.push({ item: { type: "event", ev }, s, e, pri: 0 });
      });
    }
    if (showForms) {
      deadlines.forEach((fd) => {
        if (fd.day >= weekStart && fd.day <= weekEnd) raw.push({ item: { type: "form", fd }, s: fd.day, e: fd.day, pri: 1 });
      });
    }
    if (showTasks) {
      visibleTasks.forEach((t) => {
        if (t.start <= weekEnd && t.end >= weekStart) raw.push({ item: { type: "task", task: t }, s: t.start, e: t.end, pri: 2 });
      });
    }

    const segs: Seg[] = raw
      .sort((a, b) => a.pri - b.pri || a.s.localeCompare(b.s) || b.e.localeCompare(a.e))
      .map((r) => {
        const sCol = Math.max(0, daysBetween(weekStart, r.s));
        const eCol = Math.min(6, daysBetween(weekStart, r.e));
        return { item: r.item, sCol, span: eCol - sCol + 1, lane: 0 };
      });

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
  const layerBtn = (on: boolean) =>
    `inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
      on ? "text-white border-transparent" : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"}`;
  const layerStyle = (on: boolean, bg: string): CSSProperties => (on ? { background: bg } : {});

  const selForm = evSel?.formId != null ? forms.find((f) => f.id === evSel.formId) ?? null : null;

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

        {/* レイヤ切替 */}
        <div className="flex items-center gap-1.5 ml-1 pl-3 border-l border-gray-200">
          <button onClick={() => setShowTasks(!showTasks)} className={layerBtn(showTasks)} style={layerStyle(showTasks, "#404046")}>
            <span className="w-2.5 h-1.5 rounded-sm" style={{ background: showTasks ? "rgba(255,255,255,.8)" : "#9ca3af" }} />
            タスク
          </button>
          <button onClick={() => setShowEvents(!showEvents)} className={layerBtn(showEvents)} style={layerStyle(showEvents, "#0d9488")}>
            <span className="w-2 h-2 rounded-full" style={{ background: showEvents ? "rgba(255,255,255,.85)" : "#9ca3af" }} />
            イベント
            {myEvents.length > 0 && (
              <span className={`ml-0.5 text-[10px] font-extrabold px-1.5 rounded-full ${showEvents ? "bg-white/25" : "bg-gray-100 text-gray-400"}`}>{myEvents.length}</span>
            )}
          </button>
          <button onClick={() => setShowForms(!showForms)} className={layerBtn(showForms)} style={layerStyle(showForms, "#2563eb")}>
            <span className="text-[10px]">▤</span>
            フォーム締切
            {deadlines.length > 0 && (
              <span className={`ml-0.5 text-[10px] font-extrabold px-1.5 rounded-full ${showForms ? "bg-white/25" : "bg-gray-100 text-gray-400"}`}>{deadlines.length}</span>
            )}
          </button>
        </div>

        <div className="flex-1" />
        {isOps && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {scopeOptions.map((s) => (
              <button key={s.key} onClick={() => setScope(s.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${scope === s.key ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {s.key === "mine" ? `👤 ${s.label}` : s.label}
              </button>
            ))}
          </div>
        )}
        {isOps && (
          <button onClick={() => setEvEdit(emptyEvent(todayStr))}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">＋ 予定を追加</button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="grid grid-cols-7 sticky z-30 bg-white rounded-t-xl border-b border-gray-100" style={{ top: stickyTops.week }}>
          {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
            <div key={w} className={`text-xs text-center py-1.5 ${i === 0 || i === 6 ? "text-red-400" : "text-gray-400"}`}>{w}</div>
          ))}
        </div>

        {weeks.map((wk, wi) => (
          <div key={wi} className="relative border-b border-gray-100 last:border-b-0" style={{ minHeight: 28 + wk.laneCount * LANE_H + 6 }}>
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
                    <span className={`text-xs inline-flex items-center justify-center ${isToday ? "bg-red-500 text-white rounded-full w-5 h-5" : !inMonth ? "text-gray-300" : di === 0 || di === 6 ? "text-red-400" : "text-gray-600"}`}>{d.getDate()}</span>
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
              const pos: CSSProperties = {
                left: `calc(${(seg.sCol / 7) * 100}% + 2px)`,
                width: `calc(${(seg.span / 7) * 100}% - 4px)`,
                top: 26 + seg.lane * LANE_H,
              };

              // ── イベント ──
              if (seg.item.type === "event") {
                const ev = seg.item.ev;
                const hasForm = ev.formId != null;
                return (
                  <div key={si} title={ev.title}
                    onClick={(e) => { e.stopPropagation(); setEvSel(ev); }}
                    className={`absolute flex items-center gap-1 text-white text-[10px] leading-none rounded px-1.5 py-1 cursor-pointer overflow-hidden hover:opacity-90 transition-opacity z-10 ${ev.published ? "" : "opacity-60"}`}
                    style={{ ...pos, background: ev.color }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/90 shrink-0" />
                    <span className="truncate min-w-0 font-bold">{ev.title}</span>
                    {hasForm && <span className="ml-auto shrink-0 text-[9px] font-extrabold px-1 rounded bg-white/25">▤</span>}
                  </div>
                );
              }

              // ── フォームの回答期限 ──
              if (seg.item.type === "form") {
                const fd = seg.item.fd;
                return (
                  <div key={si} title={`${fd.label}（回答期限 ${fd.deadlineAt.replace("T", " ")}）`}
                    onClick={(e) => { e.stopPropagation(); window.open(`/f/${fd.slug}`, "_blank", "noopener"); }}
                    className={`absolute flex items-center gap-1 text-white text-[10px] leading-none rounded px-1.5 py-1 cursor-pointer overflow-hidden hover:opacity-90 transition-opacity z-10 ${fd.answered ? "opacity-60" : "ring-2 ring-red-400"}`}
                    style={{ ...pos, background: "#2563eb" }}>
                    <span className="text-[9px] shrink-0">▤</span>
                    <span className="truncate min-w-0">{fd.label}</span>
                    <span className="ml-auto shrink-0 text-[9px] font-extrabold px-1 rounded bg-white/25">{fd.answered ? "済" : "未"}</span>
                  </div>
                );
              }

              // ── タスク ──
              const t = seg.item.task;
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
                <div key={si} onClick={(e) => { e.stopPropagation(); setSelected(t); }}
                  title={t.name}
                  className={`absolute flex items-center gap-0.5 text-white text-[10px] leading-none rounded px-1 py-1 cursor-pointer overflow-hidden hover:opacity-80 transition-opacity z-10 ${barColor}`}
                  style={pos}>
                  {labels.map((l, i) => (
                    <span key={i} className={`shrink-0 font-bold rounded px-0.5 ${l.cls}`} style={{ fontSize: "8px" }}>{l.t}</span>
                  ))}
                  <span className={`truncate min-w-0 ${isCompleted ? "line-through" : ""}`}>{t.name}</span>
                </div>
              );
            })}
          </div>
        ))}

        {/* 凡例 */}
        <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 border-t border-gray-100 bg-gray-50/70 text-[11px] text-gray-500 rounded-b-xl">
          <span className="font-bold text-gray-400">凡例</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-500" />タスク</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#0d9488" }} />イベント・予定</span>
          <span className="inline-flex items-center gap-1.5"><span style={{ color: "#2563eb" }}>▤</span>フォームの回答期限</span>
          <span className="ml-auto text-gray-400">未回答のフォーム締切は赤枠で表示されます。</span>
        </div>
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

      {evSel && (
        <EventDetailPopup event={evSel} form={selForm} answered={answered} index={index} isOps={isOps}
          onClose={() => setEvSel(null)}
          onEdit={(e) => { setEvSel(null); setEvEdit({ ...e }); }} />
      )}

      {evEdit && (
        <EventEditModal value={evEdit} onClose={() => setEvEdit(null)} onSaved={reloadEvents} />
      )}
    </div>
  );
}
