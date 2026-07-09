export const COL_W_DEFAULT = 18;
export const COL_W_MIN = 6;
export const COL_W_MAX = 60;
export const ROW_H_DEFAULT = 44;
export const ROW_H_MIN = 14;
export const ROW_H_MAX = 100;

// 月初日を返す
export const monthStart = (d: Date = new Date()): string =>
  new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
// n ヶ月後
export const addMonths = (dateStr: string, n: number): string => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};
// n 年後
export const addYearsStr = (dateStr: string, n: number): string => {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};

export interface GanttColumn { key: string; label: string; width: number; }
export interface GanttColumnGroup { key: string; label: string; columns: GanttColumn[]; }

export const GANTT_COLUMN_GROUPS: GanttColumnGroup[] = [
  { key: "projectName", label: "プロジェクト名", columns: [{ key: "projectName", label: "プロジェクト名", width: 100 }] },
  { key: "ankenName",   label: "分類名",         columns: [{ key: "ankenName", label: "分類名", width: 150 }] },
  { key: "importance",  label: "重要度",         columns: [{ key: "importance", label: "重要度", width: 64 }] },
  { key: "taskName",    label: "タスク名",       columns: [{ key: "taskName", label: "タスク名", width: 160 }] },
  { key: "assignees",   label: "メンバー名",     columns: [{ key: "assignees", label: "メンバー名", width: 100 }] },
  { key: "status",      label: "ステータス",     columns: [{ key: "status", label: "ステータス", width: 88 }] },
  { key: "schedule",    label: "日程",           columns: [{ key: "startDate", label: "開始日", width: 108 }, { key: "endDate", label: "終了日", width: 108 }] },
];
