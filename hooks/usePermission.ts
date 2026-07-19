// ============================================================
// usePermission — ログインユーザーの権限情報を返す
//   admin    … 管理者（全プロジェクト・全操作・マスタ管理）
//   leader   … オペレーター（担当PJ全操作・マスタ管理）
//   member   … メンバー（担当PJ閲覧 + 自分担当タスク編集のみ）
//   external … 外部（担当PJのみ閲覧）
//
//   ★オペレーターの派生ロール（ロールマスタで追加したもの）は
//     effectiveRole() により "leader" へ解決される。
//     データの参照範囲は派生元と同一で、機能の表示 / 利用可否だけを
//     role_permissions（canFor）で個別に絞る設計。
//     → 以下の canViewProject / canEditTask 等のロジックは変更不要。
// ============================================================
import { useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import type { Member, Project, Task, PermissionRole } from "../lib/models";
import type { MemberRole } from "../lib/database.types";
import { effectiveRole } from "../lib/roles";

export interface Permission {
  role: PermissionRole;
  roleLabel: MemberRole;
  myName: string;
  myId: number | null;
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

    // 派生ロールは派生元（オペレーター）へ解決してから enum に落とす
    const eff = effectiveRole(me?.role ?? null);
    const role: PermissionRole =
      eff === "管理者" ? "admin"
      : eff === "オペレーター" ? "leader"
      : eff === "外部" ? "external"
      : "member";

    // 画面表示には解決前の実ロール名を使う（「ホルダー」等をそのまま出す）
    const roleLabel: MemberRole = me?.role ?? "メンバー";
    const myName = me?.name ?? "";
    const myId = me?.id ?? null;

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

    return { role, roleLabel, myName, myId, assignedProjectIds, canViewProject, canEditTask, canCreateTask, canManageMaster };
  }, [user, members, projects]);
}
