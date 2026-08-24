"use client";
// ============================================================
// プロジェクト管理（設定 ＞ プロジェクト）
//
//   一覧（表）とカードを切り替えられる。既定は一覧。
//   ⚠️ 既定を一覧にしたのは、区分・期間・進捗を横並びで比べるのが主目的だから。
//      カードは残す（プロジェクト名を大きく見たいケース用）。切替は端末に記憶する。
//   ⚠️ 表の見出し行には必ず .tbl-head を付ける（brand.md §5）。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { Anken, Project, ProjectCategory } from "../../lib/models";
import { chipStyle, rowBarStyle, FIELD_SELECT } from "../../lib/constants";
import { Icon } from "../common/Icon";

export type ProjectSortKey = "created" | "category" | "name" | "period" | "members" | "progress";

export interface ProjectMasterTabProps {
  projects: Project[];
  anken: Anken[];
  categories: ProjectCategory[];
  onAdd: () => void;
  onEdit: (p: Project) => void;
  /** プロジェクトのみ複写（フェーズ・タスクは複製しない） */
  onDuplicate: (p: Project) => void;
  /** フェーズ管理へ移動し、そのプロジェクトを開いた状態にする */
  onGoPhase: (p: Project) => void;
  onOpenCategoryMaster: () => void;
}

const VIEW_KEY = "kc.projectMaster.view";

const SORTS: { key: ProjectSortKey; label: string }[] = [
  { key: "created",  label: "登録順" },
  { key: "category", label: "区分" },
  { key: "name",     label: "プロジェクト名" },
  { key: "period",   label: "期間" },
  { key: "members",  label: "メンバー数" },
  { key: "progress", label: "進捗" },
];

export function ProjectMasterTab({
  projects, anken, categories, onAdd, onEdit, onDuplicate, onGoPhase, onOpenCategoryMaster,
}: ProjectMasterTabProps) {
  // 表示形式は端末ごとに記憶する（人によって好みが割れる／共有すると事故らない設定）
  const [view, setView] = useState<"card" | "list">("list");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "card" || v === "list") setView(v);
    } catch { /* プライベートモード等では既定のまま */ }
  }, []);
  const changeView = (v: "card" | "list") => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* noop */ }
  };

  const [sortKey, setSortKey] = useState<ProjectSortKey>("created");
  const [asc, setAsc]         = useState(true);
  const [subOpen, setSubOpen] = useState(false);

  const catById = useMemo(
    () => new Map(categories.filter((c) => !c.isDeleted).map((c) => [c.id, c])),
    [categories],
  );
  const phaseCount = useMemo(() => {
    const m = new Map<number, number>();
    anken.forEach((a) => m.set(a.projectId, (m.get(a.projectId) ?? 0) + 1));
    return m;
  }, [anken]);

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    const catOrder = (p: Project) => {
      const c = p.categoryId != null ? catById.get(p.categoryId) : undefined;
      // 区分なしは常に末尾へ（昇順・降順どちらでも「未設定が先頭」にならないように）
      return c ? c.sortOrder * 1000 + c.id : Number.MAX_SAFE_INTEGER;
    };
    const rows = projects.slice();
    rows.sort((a, b) => {
      switch (sortKey) {
        case "category": return (catOrder(a) - catOrder(b)) * dir || a.id - b.id;
        case "name":     return a.name.localeCompare(b.name, "ja") * dir;
        case "period":   return ((a.startDate || "9999").localeCompare(b.startDate || "9999")) * dir || a.id - b.id;
        case "members":  return ((a.memberNames?.length ?? 0) - (b.memberNames?.length ?? 0)) * dir || a.id - b.id;
        case "progress": return ((a.progress ?? 0) - (b.progress ?? 0)) * dir || a.id - b.id;
        default:         return (a.id - b.id) * dir;
      }
    });
    return rows;
  }, [projects, sortKey, asc, catById]);

  /** 区分チップ。未設定は「—」で、色バーもグレーにする */
  const CategoryChip = ({ p }: { p: Project }) => {
    const c = p.categoryId != null ? catById.get(p.categoryId) : undefined;
    if (!c) return <span className="text-sm text-gray-300">—</span>;
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={chipStyle(c.color)}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
        {c.name}
      </span>
    );
  };

  const ProgressBar = ({ value }: { value: number }) => {
    const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
    return (
      <span className="flex items-center gap-2">
        <span className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden min-w-[80px]">
          <span className="block h-full rounded-full bg-red-600" style={{ width: `${v}%` }} />
        </span>
        <span className="text-xs text-gray-500 w-9 text-right shrink-0">{v}%</span>
      </span>
    );
  };

  const Actions = ({ p }: { p: Project }) => (
    <span className="flex items-center gap-1.5 justify-end whitespace-nowrap">
      <button onClick={() => onGoPhase(p)}
        className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors">フェーズへ進む</button>
      <button onClick={() => onEdit(p)}
        className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">編集</button>
      <button onClick={() => onDuplicate(p)} title="このプロジェクトだけを複写します（フェーズ・タスクは複製しません）"
        className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">複写</button>
    </span>
  );

  return (
    <div className="space-y-3">
      {/* ── ツールバー ── */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-gray-400 mr-1">{projects.length} 件</p>

        <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5">
          {(["card", "list"] as const).map((k) => (
            <button key={k} type="button" onClick={() => changeView(k)} aria-pressed={view === k}
              className={`px-3.5 py-1.5 rounded-md text-[13px] font-bold transition-colors ${
                view === k ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {k === "card" ? "カード" : "一覧"}
            </button>
          ))}
        </div>

        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as ProjectSortKey)}
          aria-label="並び順" className={`${FIELD_SELECT} w-40`}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>並び：{s.label}</option>)}
        </select>
        <button onClick={() => setAsc((v) => !v)} title={asc ? "昇順（クリックで降順）" : "降順（クリックで昇順）"}
          className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 transition-colors">
          {asc ? "▲" : "▼"}
        </button>

        {/* サブマスタ：この画面から辿れるマスタを1つにまとめる */}
        <div className="relative">
          <button onClick={() => setSubOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-red-300 hover:text-red-600 transition-colors">
            <Icon name="settings" size={15} />サブマスタ {subOpen ? "▲" : "▼"}
          </button>
          {subOpen && (
            <>
              {/* 外側クリックで閉じる透明レイヤ */}
              <div className="fixed inset-0 z-10" onClick={() => setSubOpen(false)} />
              <div className="absolute left-0 mt-1 z-20 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5">
                <p className="text-[11px] text-gray-400 px-3 py-1">プロジェクトに紐づくマスタ</p>
                <button onClick={() => { setSubOpen(false); onOpenCategoryMaster(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left">
                  <span className="w-2 h-2 rounded-full bg-red-600" />プロジェクト区分を編集
                </button>
              </div>
            </>
          )}
        </div>

        <button onClick={onAdd}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">＋ 追加</button>
      </div>

      {projects.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-12 text-center text-sm text-gray-400">
          まだプロジェクトがありません。「＋ 追加」から作成しましょう。
        </div>
      )}

      {/* ── 一覧（表）── */}
      {projects.length > 0 && view === "list" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="tbl-head">
                  <th className="text-left font-semibold px-4 py-2.5 w-36">区分</th>
                  <th className="text-left font-semibold px-3 py-2.5">プロジェクト名</th>
                  <th className="text-left font-semibold px-3 py-2.5 w-56 whitespace-nowrap">期間</th>
                  <th className="text-left font-semibold px-3 py-2.5 w-40">メンバー</th>
                  <th className="text-left font-semibold px-3 py-2.5 w-48">進捗</th>
                  <th className="text-right font-semibold px-4 py-2.5 w-64">操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => {
                  const c = p.categoryId != null ? catById.get(p.categoryId) : undefined;
                  return (
                    <tr key={p.id} className={i > 0 ? "border-t border-gray-100" : ""}>
                      <td className="px-4 py-3 relative">
                        {/* 行頭の区分色バー。表全体を色で塗らず、識別だけを担わせる */}
                        <span className="absolute left-0 top-0 bottom-0 w-1" style={rowBarStyle(c?.color ?? null)} />
                        <CategoryChip p={p} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-gray-800">{p.name}</span>
                        {p.abbreviation && <span className="ml-2 text-[11px] text-gray-400">{p.abbreviation}</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                        {p.startDate || p.dueDate ? `${p.startDate || "—"} 〜 ${p.dueDate || "—"}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-500">
                        {(p.memberNames ?? []).length} 名
                        {(p.memberNames ?? []).length > 0 && (
                          <span className="block text-[11px] text-gray-400 truncate max-w-[9rem]" title={p.memberNames.join("・")}>
                            {p.memberNames.join("・")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3"><ProgressBar value={p.progress ?? 0} /></td>
                      <td className="px-4 py-3"><Actions p={p} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── カード ── */}
      {projects.length > 0 && view === "card" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {sorted.map((p) => {
            const c = p.categoryId != null ? catById.get(p.categoryId) : undefined;
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-3.5 relative overflow-hidden">
                <span className="absolute left-0 top-0 bottom-0 w-1" style={rowBarStyle(c?.color ?? null)} />
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1"><CategoryChip p={p} /></div>
                    <p className="font-bold text-gray-800 truncate">{p.name}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">{phaseCount.get(p.id) ?? 0} フェーズ</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {p.startDate || p.dueDate ? `${p.startDate || "—"} 〜 ${p.dueDate || "—"}` : "期間未設定"}
                  　メンバー {(p.memberNames ?? []).length} 名
                </p>
                <div className="mb-2.5"><ProgressBar value={p.progress ?? 0} /></div>
                <Actions p={p} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
