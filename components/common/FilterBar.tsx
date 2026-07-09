"use client";
import { useMaster } from "../../hooks/useMaster";
import { IMPORTANCE_CONFIG } from "../../lib/constants";
import { DEFAULT_FILTERS } from "../../lib/filters";
import type { Filters } from "../../lib/filters";
import type { SelectOption } from "../../lib/models";
import { MultiSelect } from "./MultiSelect";

export interface FilterBarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  hide?: string[];
}

interface FilterGroup {
  label: string;
  key: keyof Filters;
  opts: SelectOption[];
  searchable?: boolean;
}

export function FilterBar({ filters, onChange, hide = [] }: FilterBarProps) {
  const { projects, anken, members, tasks, permission } = useMaster();
  const closedIds = new Set(projects.filter((p) => p.closeDate).map((p) => p.id));
  const activeProjects = projects.filter((p) => !closedIds.has(p.id));
  const activeAnken = anken.filter((a) => !closedIds.has(a.projectId));
  const viewableProjectIds = new Set(
    activeProjects.filter((p) => !permission || permission.canViewProject(p.id)).map((p) => p.id)
  );
  const viewableProjects = activeProjects.filter((p) => viewableProjectIds.has(p.id));
  const viewableAnken = activeAnken.filter((a) => viewableProjectIds.has(a.projectId));
  const assigneeNames = new Set<string>();
  activeProjects.forEach((p) => {
    if (viewableProjectIds.has(p.id)) (p.memberNames ?? []).forEach((n) => assigneeNames.add(n));
  });
  (tasks ?? []).forEach((t) => {
    if (viewableProjectIds.has(t.projectId)) (t.assignees ?? []).forEach((n) => assigneeNames.add(n));
  });
  const assigneeMembers = members.filter((m) => assigneeNames.has(m.name));
  const groups: FilterGroup[] = [
    { label: "進捗", key: "status", opts: [{ value: "in_progress", label: "進行中" }, { value: "pending", label: "未着手" }, { value: "completed", label: "完了" }] },
    { label: "プロジェクト", key: "project", opts: viewableProjects.map((p) => ({ value: String(p.id), label: p.name })) },
    { label: "分類", key: "anken", opts: viewableAnken.map((a) => ({ value: String(a.id), label: a.name })) },
    { label: "担当", key: "assignee", searchable: true, opts: assigneeMembers.map((m) => ({ value: m.name, label: m.name })) },
    { label: "重要度", key: "importance", opts: Object.entries(IMPORTANCE_CONFIG).map(([k, v]) => ({ value: k, label: v.label })) },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 items-start">
        {groups.filter((g) => !hide.includes(g.key)).map((g) => (
          <MultiSelect key={g.key} label={g.label} options={g.opts}
            searchable={g.searchable}
            selected={filters[g.key]}
            onChange={(val) => onChange({ ...filters, [g.key]: val })} />
        ))}
      </div>
      {Object.values(filters).some((v) => v.length > 0) && (
        <button onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-xs text-gray-400 hover:text-gray-600 underline mt-2 ml-auto block">
          クリア
        </button>
      )}
    </div>
  );
}
