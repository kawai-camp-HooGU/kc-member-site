"use client";
import { daysBetween, addDays, fmtDate } from "../../lib/dateUtils";

export interface GanttCheckpoint { num: string; name: string; off: number; }
export interface GanttDueLine { off: number; }

export interface GanttHeaderProps {
  chartStart: string;
  totalDays: number;
  colW: number;
  checkpoints?: GanttCheckpoint[];
  dueLine?: GanttDueLine | null;
}

export function GanttHeader({ chartStart, totalDays, colW, checkpoints = [], dueLine = null }: GanttHeaderProps) {
  const weeks: number[] = [];
  let c = 0;
  while (c < totalDays) { weeks.push(c); c += 7; }
  const todayOff = daysBetween(chartStart, new Date().toISOString().slice(0, 10));
  return (
    <div className="relative h-8 bg-gray-500 border-b border-gray-400" style={{ width: totalDays * colW }}>
      {weeks.map((off) => (
        <div key={off} className="absolute top-0 h-full flex items-center text-xs text-gray-100 border-l border-gray-400 pl-1"
          style={{ left: off * colW }}>{fmtDate(addDays(chartStart, off))}</div>
      ))}
      {dueLine && (
        <div className="absolute top-0 bottom-0 z-20" style={{ left: dueLine.off * colW, borderLeft: "2px dotted #ef4444" }}>
          <span className="absolute left-1 bottom-0.5 text-[10px] text-white bg-red-500 rounded px-1.5 whitespace-nowrap">期限</span>
        </div>
      )}
      {checkpoints.map((cp) => (
        <div key={cp.num} className="absolute top-0 bottom-0 z-20" style={{ left: cp.off * colW, borderLeft: "2px dashed #7c3aed" }}>
          <span className="absolute left-1 top-1 text-[10px] text-white bg-violet-600 rounded px-1.5 whitespace-nowrap">{cp.num} {cp.name}</span>
        </div>
      ))}
      {todayOff >= 0 && todayOff <= totalDays && (
        <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: todayOff * colW }}>
          <span className="absolute left-1 text-xs text-red-500 font-semibold whitespace-nowrap">今日</span>
        </div>
      )}
    </div>
  );
}
