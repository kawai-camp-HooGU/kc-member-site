// ============================================================
// MasterContext — プロジェクト・案件・メンバー・テンプレート・タスク・権限・全般設定を
// 全コンポーネントで共有するコンテキスト。
// ============================================================
import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Project, Anken, Member, Template, Task } from "../lib/models";
import type { Permission } from "./usePermission";
import type { PermMap, Feature } from "../lib/permissions";

export interface MasterContextValue {
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  anken: Anken[];
  setAnken: Dispatch<SetStateAction<Anken[]>>;
  members: Member[];
  setMembers: Dispatch<SetStateAction<Member[]>>;
  templates: Template[];
  setTemplates: Dispatch<SetStateAction<Template[]>>;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  permission: Permission;
  perms: PermMap;
  setPerms: Dispatch<SetStateAction<PermMap>>;
  /** ログインユーザーのロールが機能を使えるか（ロール権限マスタ判定） */
  can: (feature: Feature) => boolean;
}

export const MasterContext = createContext<MasterContextValue | null>(null);

/** MasterContext を取得（Provider 内でのみ使用する前提） */
export function useMaster(): MasterContextValue {
  const ctx = useContext(MasterContext);
  if (!ctx) throw new Error("useMaster は MasterContext.Provider の内側で使用してください");
  return ctx;
}
