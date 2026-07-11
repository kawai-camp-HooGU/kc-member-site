// ============================================================
// ロール権限マスタ（ロール × 機能）
//   機能の表示/利用可否をロールごとに制御。設定「権限」タブで編集。
// ============================================================
import { supabase } from "./supabase";
import type { MemberRole } from "./database.types";

export const ROLES: MemberRole[] = ["管理者", "オペレーター", "メンバー", "外部"];

export type FeatureGroup = "screen" | "func";
export interface FeatureDef { key: string; label: string; group: FeatureGroup; }
export const FEATURES: FeatureDef[] = [
  // ── 画面（サイドバー準拠の表示 / 非表示）──
  { key: "home",          label: "ホーム",             group: "screen" },
  { key: "dashboard",     label: "ダッシュボード",       group: "screen" },
  { key: "kanban",        label: "カンバン",           group: "screen" },
  { key: "gantt",         label: "ガント",             group: "screen" },
  { key: "calendar",      label: "カレンダー",          group: "screen" },
  { key: "content",       label: "コンテンツ",          group: "screen" },
  { key: "chat",          label: "チャット",           group: "screen" },
  { key: "broadcast",     label: "一斉配信",           group: "screen" },
  { key: "scenario",      label: "シナリオ配信",        group: "screen" },
  { key: "bulk_register", label: "一括登録",           group: "screen" },
  { key: "notification",  label: "通知設定",           group: "screen" },
  { key: "master",        label: "設定（マスタ管理）",   group: "screen" },
  { key: "help",          label: "ヘルプ",             group: "screen" },
  // ── 機能（使用有無）──
  { key: "content_manage", label: "コンテンツ設定",           group: "func" },
  { key: "chatwork",       label: "チャットワーク通知",       group: "func" },
  { key: "notify",         label: "通知",                     group: "func" },
  { key: "ai",             label: "AI連携（チャットのAI項目）", group: "func" },
];
export const FEATURE_GROUP_LABEL: Record<FeatureGroup, string> = {
  screen: "画面（表示 / 非表示）",
  func:   "機能（使用有無）",
};
export type Feature = string;

/** `${role}::${feature}` → enabled のマップ */
export type PermMap = Record<string, boolean>;
export const permKey = (role: string, feature: string): string => `${role}::${feature}`;

// 既定値（管理者/オペレーター=ほぼ全て、メンバー/外部=閲覧系のみ）
const ALLOW: Record<string, string[]> = {
  "管理者":       FEATURES.map((f) => f.key),
  "オペレーター": FEATURES.map((f) => f.key),
  "メンバー":     ["home", "kanban", "gantt", "calendar", "content", "chat", "notification", "help"],
  "外部":         ["home", "kanban", "gantt", "calendar", "content", "notification", "help"],
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
