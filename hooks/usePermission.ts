// ============================================================
// usePermission — ログインユーザーの権限情報を返す
//   admin    … 管理者（全プロジェクト・全操作・マスタ管理）
//   leader   … リーダー（担当PJ全操作・マスタ管理）
//   member   … メンバー（担当PJ閲覧 + 自分担当タスク編集のみ）
//   external … 外部（担当PJのみ閲覧）
// ============================================================
import { useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import type { Member, Project, Task, PermissionRole } from "../lib/models";

export interface Permission {
  role: PermissionRole;
  myName: string;
  assignedProjectIds: Set<number>;
  canViewProject: (projectId: number) => boolean;
  canEditTask: (task: Task) => boolean;
  canCreateTask: (projectId: number) => boolean;
  canManageMaster: boolean;
}

export function usePermission(
  user: User | null,
  members: Member[],
  projects: Project[]
): Permission {
  return useMemo<Permission>(() => {
    const me = members.find((m) => m.userId === user?.id) ?? null;
    const role: PermissionRole =
      me?.role === "管理者" ? "admin"
      : me?.role === "リーダー" ? "leader"
      : me?.role === "外部" ? "external"
      : "member";
    const myName = me?.name ?? "";

    const assignedProjectIds = new Set(
      projects.filter((p) => (p.memberNames ?? []).includes(myName)).map((p) => p.id)
    );

    const canViewProject = (projectId: number): boolean => {
      if (role === "admin") return true;
      return assignedProjectIds.has(projectId);
    };

    const canEditTask = (task: Task): boolean => {
      if (role === "admin") return true;
      if (role === "external") return false;
      if (!assignedProjectIds.has(task.projectId)) return false;
      if (role === "leader") return true;
      return task.assignees.includes(myName);
    };

    const canCreateTask = (projectId: number): boolean => {
      if (role === "admin") return true;
      if (role === "leader" || role === "member") return assignedProjectIds.has(projectId);
      return false;
    };

    const canManageMaster = role === "admin" || role === "leader";

    return { role, myName, assignedProjectIds, canViewProject, canEditTask, canCreateTask, canManageMaster };
  }, [user, members, projects]);
}
