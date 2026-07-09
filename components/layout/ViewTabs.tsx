"use client";
import { STATUS_CONFIG, IMPORTANCE_CONFIG } from "../../lib/constants";
import { DEFAULT_FILTERS } from "../../lib/filters";
import type { Filters } from "../../lib/filters";
import type { Project, Anken, Status, Importance } from "../../lib/models";
import { VIEW_TABS, FILTER_CHIP_META } from "./viewConfig";

type ChipKind = keyof typeof FILTER_CHIP_META;

export interface ViewTabsProps {
  view: string;
  onChange: (k: string) => void;
  filters?: Filters;
  projects?: Project[];
  anken?: Anken[];
}

// カンバン/ガント/カレンダー切替タブ（抽出条件を維持したまま横移動）
export function ViewTabs({ view, onChange, filters, projects = [], anken = [] }: ViewTabsProps) {
  const f = filters ?? DEFAULT_FILTERS;
  const chips: { k: ChipKind; t: string }[] = [];
  (f.project ?? []).forEach((v) => chips.push({ k: "project", t: projects.find((p) => String(p.id) === String(v))?.name ?? v }));
  (f.anken ?? []).forEach((v) => chips.push({ k: "anken", t: anken.find((a) => String(a.id) === String(v))?.name ?? v }));
  (f.status ?? []).forEach((v) => chips.push({ k: "status", t: STATUS_CONFIG[v as Status]?.label ?? v }));
  (f.assignee ?? []).forEach((v) => chips.push({ k: "assignee", t: v }));
  (f.importance ?? []).forEach((v) => chips.push({ k: "importance", t: IMPORTANCE_CONFIG[v as Importance]?.icon || "なし" }));
  return (
    <div data-viewtabs className="flex items-center gap-1 mb-4 border-b border-gray-200 sticky top-0 z-50 bg-gray-50 -mx-4 px-4">
      {VIEW_TABS.map((t) => {
        const active = view === t.key;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              active ? "border-red-600 text-red-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        );
      })}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pb-1 pl-3">
          <span className="text-[11px] text-gray-400 shrink-0">抽出条件</span>
          {chips.map((c, i) => (
            <span key={i} className={`text-[11px] border rounded-full px-2 py-0.5 whitespace-nowrap ${FILTER_CHIP_META[c.k].cls}`}>
              {FILTER_CHIP_META[c.k].label}：{c.t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
