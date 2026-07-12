import type { Project, Anken } from "../../lib/models";
import { dateOrderError } from "../../lib/validators";

export type ProjectForm = Partial<Project> & { templateId?: number | null };
export type AnkenForm = Partial<Anken>;

export interface NotifyOverrideEntry { mode?: string; header?: string; lead?: string; taskLine?: string; tail?: string; }
export type NotifyOverrides = Record<string, NotifyOverrideEntry>;
export interface NotifyAppSetting { enabled: boolean; header: string; lead: string; taskLine: string; tail: string; }
export type NotifyAppMap = Record<string, NotifyAppSetting>;
export interface NotifyValues { header?: string; lead?: string; taskLine?: string; tail?: string; }

// プロジェクト用 日付の前後関係エラー（開始日≦期限日≦クローズ日）。問題なければ null。
export const projectDateError = (f: ProjectForm | null | undefined): string | null =>
  f ? dateOrderError(f.startDate, f.dueDate, f.closeDate) : null;

// プロジェクト用 必須チェック（プロジェクト名・略称・期限日・メンバー1名以上・日付の前後関係）
export const projectFormValid = (f: ProjectForm | null | undefined): boolean =>
  !!(f && f.name?.trim() && f.abbreviation?.trim() && f.dueDate && ((f.memberNames?.length ?? 0) > 0)
    && !projectDateError(f));

// 保存ボタンが押せない理由（未入力の必須項目）を返す。問題なければ null。
export const projectMissingLabel = (f: ProjectForm | null | undefined): string | null => {
  const miss: string[] = [];
  if (!f?.name?.trim()) miss.push("プロジェクト名");
  if (!f?.abbreviation?.trim()) miss.push("略称");
  if (!f?.dueDate) miss.push("期限日");
  if (!((f?.memberNames?.length ?? 0) > 0)) miss.push("関連メンバー");
  return miss.length ? `未入力：${miss.join("・")}` : null;
};
