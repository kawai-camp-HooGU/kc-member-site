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
  { key: "form",          label: "フォーム",           group: "screen" },
  { key: "bulk_register", label: "一括登録",           group: "screen" },
  { key: "notification",  label: "通知設定",           group: "screen" },
  { key: "master",        label: "設定（マスタ管理）",   group: "screen" },
  { key: "help",          label: "ヘルプ",             group: "screen" },
  // ── 機能（使用有無）──
  { key: "content_manage", label: "コンテンツ設定",           group: "func" },
  { key: "chatwork",       label: "チャットワーク通知",       group: "func" },
  { key: "notify",         label: "通知",                     group: "func" },
  // ── AI機能：以下の4つは用途が異なる別機能（重複ではない）──
  { key: "ai",             label: "AIアシスタント（スタッフ返信支援）", group: "func" },  // 運営チャットの返信提案パネル
  { key: "ai_consult",     label: "AI相談チャット（メンバー）",   group: "func" },  // メンバー画面のAI相談
  { key: "ai_html",        label: "AI HTMLコード生成（コンテンツ）", group: "func" },  // コンテンツ本文のHTML生成
  { key: "ai_draft",       label: "AI 配信原稿生成（一斉配信）",   group: "func" },  // Broadcastの原稿生成
];
export const FEATURE_GROUP_LABEL: Record<FeatureGroup, string> = {
  screen: "画面（表示 / 非表示）",
  func:   "機能（使用有無）",
};
export type Feature = string;

// ── ジャンル（サイドバーの並びに準拠）──────────────────────
//   権限設定の表はこの単位でグループ化・折りたたみ・一括ON/OFFする。
export interface FeatureGenre {
  id: string;
  name: string;   // 英語見出し（サイドバーと同じ）
  jp: string;     // 補足の日本語
  keys: string[]; // 機能キー（FEATURES の key）
}
export const FEATURE_GENRES: FeatureGenre[] = [
  { id: "general",      name: "General",      jp: "共通",         keys: ["home", "help"] },
  { id: "content",      name: "Content",      jp: "コンテンツ",   keys: ["content", "content_manage", "ai_html"] },
  { id: "community",    name: "Community",    jp: "コミュニティ", keys: ["chat", "ai", "ai_consult"] },
  { id: "notification", name: "Notification", jp: "通知",         keys: ["notification", "notify", "chatwork"] },
  { id: "roadmap",      name: "Roadmap",      jp: "ロードマップ", keys: ["dashboard", "kanban", "gantt", "calendar", "bulk_register"] },
  { id: "admin",        name: "Admin",        jp: "管理",         keys: ["broadcast", "scenario", "form", "master", "ai_draft"] },
];

/** ジャンルに属する機能定義（未定義キーは除外） */
export function genreFeatures(g: FeatureGenre): FeatureDef[] {
  return g.keys
    .map((k) => FEATURES.find((f) => f.key === k))
    .filter((f): f is FeatureDef => Boolean(f));
}

/** どのジャンルにも属さない機能（機能追加時の取りこぼし防止） */
export function orphanFeatures(): FeatureDef[] {
  const known = new Set(FEATURE_GENRES.flatMap((g) => g.keys));
  return FEATURES.filter((f) => !known.has(f.key));
}

/** 管理者は常に全機能ON（誤って自分の権限を落とせないようにする） */
export const ADMIN_ROLE = "管理者";
export const isAdminRole = (role: string): boolean => role === ADMIN_ROLE;

/** `${role}::${feature}` → enabled のマップ */
export type PermMap = Record<string, boolean>;
export const permKey = (role: string, feature: string): string => `${role}::${feature}`;

// 既定値（管理者/オペレーター=ほぼ全て、メンバー/外部=閲覧系のみ）
//   ai_consult … メンバー向けのAI相談。スタッフ画面には出さない
//   ai_html    … コンテンツ本文HTMLの生成。サーバー側は requireAdmin のため管理者のみ
const OPS_EXCLUDE = ["ai_consult", "ai_html"];
const ALLOW: Record<string, string[]> = {
  "管理者":       FEATURES.map((f) => f.key),
  "オペレーター": FEATURES.map((f) => f.key).filter((k) => !OPS_EXCLUDE.includes(k)),
  "メンバー":     ["home", "kanban", "gantt", "calendar", "content", "chat", "notification", "help", "ai_consult"],
  "外部":         ["home", "kanban", "gantt", "calendar", "content", "notification", "help"],
};
export const DEFAULT_PERMS: PermMap = (() => {
  const m: PermMap = {};
  for (const role of ROLES) for (const f of FEATURES) m[permKey(role, f.key)] = (ALLOW[role] ?? []).includes(f.key);
  return m;
})();

/** 指定ロールが機能を使えるか（管理者は常時ON。未設定は既定値にフォールバック） */
export function canFor(perms: PermMap | null, role: string, feature: Feature): boolean {
  if (isAdminRole(role)) return true;
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
