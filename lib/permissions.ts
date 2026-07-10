// ============================================================
// ロール権限マスタ（ロール × 機能）
//   機能の表示/利用可否をロールごとに制御。設定「権限」タブで編集。
// ============================================================
import { supabase } from "./supabase";
import type { MemberRole } from "./database.types";

export const ROLES: MemberRole[] = ["管理者", "オペレーター", "メンバー", "外部"];

export interface FeatureDef { key: string; label: string; }
export const FEATURES: FeatureDef[] = [
  { key: "dashboard",      label: "ダッシュボード" },
  { key: "kanban",         label: "カンバン" },
  { key: "gantt",          label: "ガント" },
  { key: "calendar",       label: "カレンダー" },
  { key: "content",        label: "コンテンツ" },
  { key: "content_manage", label: "コンテンツ設定" },
  { key: "bulk_register",  label: "一括登録" },
  { key: "chatwork",       label: "チャットワーク" },
  { key: "chat",           label: "チャット" },
  { key: "master",         label: "設定（マスタ管理）" },
];
export type Feature = string;

/** `${role}::${feature}` → enabled のマップ */
export type PermMap = Record<string, boolean>;
export const permKey = (role: string, feature: string): string => `${role}::${feature}`;

// 既定値（管理者/オペレーター=ほぼ全て、メンバー/外部=閲覧系のみ）
const ALLOW: Record<string, string[]> = {
  "管理者":       FEATURES.map((f) => f.key),
  "オペレーター": FEATURES.map((f) => f.key),
  "メンバー":     ["kanban", "gantt", "calendar", "content", "chat"],
  "外部":         ["kanban", "gantt", "calendar", "content"],
};
export const DEFAULT_PERMS: PermMap = (() => {
  const m: PermMap = {};
  for (const role of ROLES) for (const f of FEATURES) m[permKey(role, f.key)] = (ALLOW[role] ?? []).includes(f.key);
  return m;
})();

/** 指定ロールが機能を使えるか（未設定は既定値にフォールバック） */
export function canFor(perms: PermMap | null, role: string, feature: Feature): boolean {
  const k = permKey(role, feature);
  const m = perms ?? DEFAULT_PERMS;
  return m[k] ?? DEFAULT_PERMS[k] ?? false;
}

export async function loadRolePermissions(): Promise<PermMap> {
  const { data, error } = await supabase.from("role_permissions").select("*");
  if (error || !data || data.length === 0) return { ...DEFAULT_PERMS };
  const m: PermMap = { ...DEFAULT_PERMS };
  for (const r of data) m[permKey(r.role, r.feature)] = r.enabled;
  return m;
}

export async function saveRolePermission(role: string, feature: string, enabled: boolean): Promise<void> {
  await supabase.from("role_permissions").upsert({ role, feature, enabled }, { onConflict: "role,feature" });
}
