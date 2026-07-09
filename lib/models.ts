// ============================================================
// アプリ内ドメイン型（camelCase）
// lib/supabase.ts の変換ヘルパー（toProject 等）の戻り値と一致させる。
// ============================================================
import type { RiskLevel, TaskStatus, MemberRole } from "./database.types";

export type Risk = RiskLevel;
export type Status = TaskStatus;
export type Role = MemberRole;

/** 重要度: 1=Ⅰ / 2=Ⅱ / 3=Ⅲ / "none"=なし（DBのNULLに対応） */
export type Importance = 1 | 2 | 3 | "none";

/** 権限（内部ロール）: members.role（日本語）から解決 */
export type PermissionRole = "admin" | "leader" | "member" | "external";

export interface Project {
  id: number;
  name: string;
  abbreviation: string;
  startDate: string;
  dueDate: string;
  closeDate: string;
  notifyChat: string;
  checkpoint1Name: string;
  checkpoint1Date: string;
  checkpoint2Name: string;
  checkpoint2Date: string;
  checkpoint3Name: string;
  checkpoint3Date: string;
  progress: number;
  risk: Risk;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  memberNames: string[];
  notifyOverrides: Record<string, unknown>;
  isDeleted: boolean;
}

export interface Anken {
  id: number;
  projectId: number;
  name: string;
  abbreviation: string;
  leaderId: number | null;
  leader: string;
  progress: number;
  risk: Risk;
  dueDate: string;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  isDeleted: boolean;
}

export interface Task {
  id: number;
  projectId: number;
  ankenId: number;
  name: string;
  assigneeIds: number[];
  assignees: string[];
  start: string;
  end: string;
  status: Status;
  risk: Risk;
  progressMemo: string;
  specialNotes: string;
  materials: string;
  completedAt: string | null;
  importance: Importance;
  updatedAt: string | null;
  updatedBy: string;
}

export interface Member {
  id: number;
  name: string;
  role: Role;
  userId: string | null;
  email: string;
  company: string;
  chatId: string;
  isDeleted: boolean;
}

export interface TemplateTask {
  name: string;
  startOffset: number | "";
  endOffset: number | "";
  importance: Importance;
  progressMemo: string;
  specialNotes: string;
  materials: string;
}

export interface TemplateAnken {
  name: string;
  tasks: TemplateTask[];
}

export interface Template {
  id: number | null;
  name: string;
  anken: TemplateAnken[];
}

/** id をキーにした member 参照マップ（表示名解決に使用） */
export type MemberById = Record<number, Member>;

// ── 新機能: コンテンツ ───────────────────────────────────────
export type ContentGenre = "video" | "file" | "link";

export interface ContentItem {
  id: number;
  genre: ContentGenre;
  title: string;
  meta: string;
  date?: string;
  badge?: string;
  ext?: string;
  url?: string;
  licon?: string;
  /** 公開対象: "all"=全員 / string[]=メンバー名の配列 */
  target: "all" | string[];
  published: boolean;
}

/** fetchAllData の戻り値 */
export interface AppData {
  projects: Project[];
  anken: Anken[];
  tasks: Task[];
  members: Member[];
  templates: Template[];
}

/** MultiSelect 等の選択肢 */
export interface SelectOption {
  value: string;
  label: string;
}
