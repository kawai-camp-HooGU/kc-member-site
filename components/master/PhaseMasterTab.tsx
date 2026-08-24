"use client";
// ============================================================
// フェーズ管理（設定 ＞ フェーズ）
//
//   プロジェクトを1つ選び、そのフェーズを上から順に並べる画面。
//   ⚠️ 以前は全プロジェクトのアコーディオンだったが、フェーズは「1つのPJの工程を
//      順に追う」ものなので、プロジェクトを先に選ぶ形に変えた。
//   ⚠️ 左端の連番は表示上の通し番号（1,2,3…）。DBの id や sort_order ではない。
//      並べ替え機能を付けるときは anken に sort_order を足すこと。
// ============================================================
import { useMemo, useState } from "react";
import type { Anken, PhaseStatus, Project, ProjectCategory, Task } from "../../lib/models";
import { chipStyle, FIELD_SELECT } from "../../lib/constants";
import { resolveStatus, statusView } from "../../lib/phaseStatus";
import { Icon } from "../common/Icon";

export interface PhaseMasterTabProps {
  projects: Project[];
  anken: Anken[];
  tasks: Task[];
  categories: ProjectCategory[];
  phaseStatuses: PhaseStatus[];
  /** 選択中プロジェクト（null = 未選択。projects の先頭を既定にする） */
  projectId: number | null;
  onSelectProject: (id: number) => void;
  onAddPhase: (projectId: number) => void;
  onEditPhase: (a: Anken) => void;
  /** テンプレートからフェーズ・タスクを流し込む */
  onApplyTemplate: (p: Project) => void;
  onOpenStatusMaster: () => void;
}

export function PhaseMasterTab({
  projects, anken, tasks, categories, phaseStatuses,
  projectId, onSelectProject, onAddPhase, onEditPhase, onApplyTemplate, onOpenStatusMaster,
}: PhaseMasterTabProps) {
  const [hideDone, setHideDone] = useState(true);

  const current = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  const category = current?.categoryId != null
    ? categories.find((c) => c.id === current.categoryId && !c.isDeleted) ?? null
    : null;
  const accent = category?.color ?? "#dc2626";

  const taskCount = useMemo(() => {
    const m = new Map<number, number>();
    tasks.forEach((t) => m.set(t.ankenId, (m.get(t.ankenId) ?? 0) + 1));
    return m;
  }, [tasks]);

  const all = useMemo(
    () => (current ? anken.filter((a) => a.projectId === current.id) : []),
    [anken, current],
  );
  const rows = useMemo(() => {
    if (!hideDone) return all;
    return all.filter((a) => !(resolveStatus(phaseStatuses, a.statusId, current?.categoryId ?? null)?.isDone ?? false));
  }, [all, hideDone, phaseStatuses, current]);

  if (projects.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-400">
        プロジェクトがありません。先に「プロジェクト」から作成してください。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── ヘッダ：プロジェクト選択 ＋ 進捗ステータス編集 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">プロジェクト</span>
        <span className="inline-flex items-center gap-2 border border-gray-200 rounded-xl pl-3 pr-1 py-1 bg-white">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
          <select value={current?.id ?? ""} onChange={(e) => onSelectProject(Number(e.target.value))}
            aria-label="プロジェクトを選択" className="bg-transparent text-sm font-bold text-gray-800 focus:outline-none max-w-[18rem]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-[11px] text-gray-400 pr-2">{all.length} フェーズ</span>
        </span>

        <button onClick={onOpenStatusMaster}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-red-300 hover:text-red-600 transition-colors">
          <Icon name="settings" size={15} />進捗ステータス編集
        </button>
      </div>

      {/* ── フェーズ一覧 ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <span className="text-xs text-gray-400">{rows.length} フェーズ</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)}
              className="w-3.5 h-3.5 accent-red-600" />
            完了を除外
          </label>
        </div>

        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            {all.length === 0
              ? "まだフェーズがありません。「＋ フェーズを追加」から作成しましょう。"
              : "表示できるフェーズがありません（完了を除外中）。"}
          </div>
        )}

        {rows.map((a, i) => {
          const st = statusView(resolveStatus(phaseStatuses, a.statusId, current?.categoryId ?? null));
          return (
            <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              {/* 通し番号。DBの並びではなく「上から何番目か」を示す */}
              <span className="w-7 h-7 rounded-lg text-white text-xs font-bold flex items-center justify-center shrink-0"
                style={{ backgroundColor: accent }}>{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-gray-800 truncate">{a.name}</span>
                {(a.leader || a.dueDate) && (
                  <span className="block text-[11px] text-gray-400 truncate">
                    {a.leader ? `リーダー：${a.leader}` : ""}{a.leader && a.dueDate ? "　" : ""}{a.dueDate ? `期限：${a.dueDate}` : ""}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={chipStyle(st.color)}>
                {st.name}
              </span>
              <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 whitespace-nowrap shrink-0">
                タスク {taskCount.get(a.id) ?? 0}
              </span>
              <button onClick={() => onEditPhase(a)}
                className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors shrink-0">編集</button>
            </div>
          );
        })}
      </div>

      {/* ── 下部アクション ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <button onClick={() => current && onApplyTemplate(current)} disabled={!current}
          className="py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-40 transition-colors">
          テンプレ反映
        </button>
        <button onClick={() => current && onAddPhase(current.id)} disabled={!current}
          className="py-2.5 rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-40 transition-colors">
          ＋ フェーズを追加
        </button>
      </div>

      <p className="text-[11px] text-gray-400">
        左の番号は表示上の通し番号です。ステータスは「進捗ステータス編集」で追加・並べ替えできます
        {category ? `（この区分「${category.name}」専用のステータスも作れます）` : "（区分を設定すると、区分専用のステータスも使えます）"}。
      </p>
    </div>
  );
}
