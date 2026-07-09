// 共通フィルター（全ビュー共通）。各キーは選択値の配列（空配列＝すべて表示）。
import type { Task } from "./models";

export interface Filters {
  status: string[];
  project: string[];
  anken: string[];
  assignee: string[];
  importance: string[];
}

export const DEFAULT_FILTERS: Filters = {
  status: [], project: [], anken: [], assignee: [], importance: [],
};

export function applyFilters(tasks: Task[], filters: Filters): Task[] {
  return tasks
    .filter((t) => filters.status.length   === 0 || filters.status.includes(t.status))
    .filter((t) => filters.project.length  === 0 || filters.project.includes(String(t.projectId)))
    .filter((t) => filters.anken.length    === 0 || filters.anken.includes(String(t.ankenId)))
    .filter((t) => filters.assignee.length === 0 || t.assignees.some((a) => filters.assignee.includes(a)))
    .filter((t) => !filters.importance || filters.importance.length === 0 || filters.importance.includes(String(t.importance ?? "none")));
}
