import type { Project, Anken } from "../../lib/models";

export type ProjectForm = Partial<Project> & { templateId?: number | null };
export type AnkenForm = Partial<Anken>;

export interface NotifyOverrideEntry { mode?: string; header?: string; lead?: string; taskLine?: string; tail?: string; }
export type NotifyOverrides = Record<string, NotifyOverrideEntry>;
export interface NotifyAppSetting { enabled: boolean; header: string; lead: string; taskLine: string; tail: string; }
export type NotifyAppMap = Record<string, NotifyAppSetting>;
export interface NotifyValues { header?: string; lead?: string; taskLine?: string; tail?: string; }

// プロジェクト用 必須チェック（プロジェクト名・略称・期限日・メンバー1名以上）
export const projectFormValid = (f: ProjectForm | null | undefined): boolean =>
  !!(f && f.name?.trim() && f.abbreviation?.trim() && f.dueDate && ((f.memberNames?.length ?? 0) > 0));
