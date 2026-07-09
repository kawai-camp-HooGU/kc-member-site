"use client";
import { RISK_CONFIG, IMPORTANCE_CONFIG } from "../../lib/constants";
import type { Risk, Task, Importance } from "../../lib/models";

export function RiskBadge({ risk }: { risk: Risk }) {
  const c = RISK_CONFIG[risk];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${c.badge}`}>{c.label}</span>;
}

export function ProgressBar({ progress }: { progress: number; risk?: Risk }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-gray-200 rounded-full h-2.5">
        <div className="h-2.5 rounded-full bg-red-500" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-sm font-bold text-gray-700 w-10 text-right">{progress}%</span>
    </div>
  );
}

// 重要度ごとの件数サマリー（総タスク数 / 今週期限 / 遅延 / 完了）— Ⅲ→Ⅱ→Ⅰ→なし
export function ImportanceSummary({ tasks, compact = false }: { tasks: Task[]; compact?: boolean }) {
  const today   = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const normImp = (t: Task): Importance => (t.importance && t.importance !== "none") ? t.importance : "none";
  const rows = ([3, 2, 1, "none"] as Importance[]).map((key) => {
    const vt = tasks.filter((t) => normImp(t) === key);
    return {
      key, cfg: IMPORTANCE_CONFIG[key], total: vt.length,
      due:  vt.filter((t) => t.status !== "completed" && t.end && t.end >= today && t.end <= weekEnd).length,
      late: vt.filter((t) => t.status !== "completed" && t.end && t.end < today).length,
      done: vt.filter((t) => t.status === "completed").length,
    };
  });
  const cols   = compact ? "76px 1fr 1fr 1fr 1fr" : "84px 1fr 1fr 1fr 1fr";
  const numCls = compact ? "text-sm" : "text-base";
  const pad    = compact ? "px-1 py-0.5" : "px-1.5 py-0.5";
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="grid gap-1 px-3 py-1 text-[11px] font-semibold border-b border-gray-100 bg-gray-50/60" style={{ gridTemplateColumns: cols }}>
        <span className="text-gray-400 text-center self-center">重要度</span>
        <span className="text-center text-gray-500">総タスク数</span>
        <span className="text-center text-orange-600">今週期限</span>
        <span className="text-center text-yellow-600">遅延タスク</span>
        <span className="text-center text-red-600">完了タスク</span>
      </div>
      {rows.map((r, i) => (
        <div key={String(r.key)}
          className={`grid gap-1 items-center ${pad} ${i > 0 ? "border-t border-gray-100" : ""} ${r.key === 3 ? "bg-red-50" : ""}`}
          style={{ gridTemplateColumns: cols, ...(r.key === 3 ? { boxShadow: "inset 3px 0 0 #dc2626" } : null) }}>
          <div className="text-center">
            <span className={`text-[11px] font-bold px-1.5 py-0 rounded-full ${r.cfg.chip}`}>{r.cfg.icon || "なし"}</span>
          </div>
          <div className={`text-center ${numCls} font-bold ${r.total > 0 ? "text-gray-700"  : "text-gray-300"}`}>{r.total}</div>
          <div className={`text-center ${numCls} font-bold ${r.due   > 0 ? "text-orange-600" : "text-gray-300"}`}>{r.due}</div>
          <div className={`text-center ${numCls} font-bold ${r.late  > 0 ? "text-yellow-600" : "text-gray-300"}`}>{r.late}</div>
          <div className={`text-center ${numCls} font-bold ${r.done  > 0 ? "text-red-600"   : "text-gray-300"}`}>{r.done}</div>
        </div>
      ))}
    </div>
  );
}
