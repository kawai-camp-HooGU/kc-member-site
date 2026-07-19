// ============================================================
// ロール権限マスタ（ロール × 機能）
//   機能の表示/利用可否をロールごとに制御。設定「権限」タブで編集。
// ============================================================
import { supabase } from "./supabase";
import type { MemberRole } from "./database.types";
import { allRoleKeys, SYSTEM_ROLES, BASE_ROLE } from "./roles";

/**
 * システム固定ロール（既定値 DEFAULT_PERMS の定義対象）。
 *
 * ⚠️ 権限表の列に使うロール一覧は roles マスタから取るため、
 *    UI 側では ROLES ではなく roleColumns() を使うこと。
 *    ここは「既定値を持つロール」の定義に限定する。
 */
export const ROLES: MemberRole[] = [...SYSTEM_ROLES];

/**
 * 権限表に並べるロール（システム固定 ＋ 派生ロール）。
 * ロールマスタ未ロード時はシステム固定4ロールにフォールバックする。
 */
export function roleColumns(): string[] {
  const keys = allRoleKeys();
  return keys.length > 0 ? keys : [...SYSTEM_ROLES];
}

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
  { key: "event_manage",   label: "イベント・予定の管理",     group: "func" },
  { key: "chatwork",       label: "チャットワーク通知",       group: "func" },
  { key: "notify",         label: "通知",                     group: "func" },
  // ── AI機能：以下の4つは用途が異なる別機能（重複ではない）──
  { key: "ai",             label: "AIアシスタント（スタッフ返信支援）", group: "func" },  // 運営チャットの返信提案パネル
  { key: "ai_consult",     label: "AI相談チャット（メンバー）",   group: "func" },  // メンバー画面のAI相談
  { key: "ai_html",        label: "AI HTMLコード生成（コンテンツ）", group: "func" },  // コンテンツ本文のHTML生成
  { key: "ai_draft",       label: "AI 配信原稿生成（一斉配信）",   group: "func" },  // Broadcastの原稿生成
  // ── 決済 ──
  { key: "payment_manage", label: "決済情報の管理",                   group: "func" },  // /ops/payments の登録・編集・照合
  { key: "payment_master", label: "決済マスタの編集",                 group: "func" },  // 商品種別・サイト・方法マスタ
  { key: "payment_admin",  label: "決済スクショ閲覧・完全削除",       group: "func" },  // 影響大。既定は管理者のみ
  // ── 設定（マスタ）の各メニューの表示 / 非表示 ──
  //   「設定」全体は master で出し分けるが、その中のメニュー1つ1つを更に絞れるようにする。
  //   ※「権限」メニューだけは常に管理者専用（トグルを設けない。MasterView 側で adminOnly 固定）。
  //   ※ コンテンツ設定＝content_manage、イベント・予定の管理＝event_manage を流用する（重複キーを作らない）。
  { key: "set_member",   label: "設定：メンバー",       group: "screen" },
  { key: "set_attribute",label: "設定：属性",           group: "screen" },
  { key: "set_news",     label: "設定：お知らせ",       group: "screen" },
  { key: "set_source",   label: "設定：流入経路",       group: "screen" },
  { key: "set_welcome",  label: "設定：初回メッセージ", group: "screen" },
  { key: "set_notify",   label: "設定：通知の文面",     group: "screen" },
  { key: "set_project",  label: "設定：プロジェクト",   group: "screen" },
  { key: "set_anken",    label: "設定：分類（案件）",   group: "screen" },
  { key: "set_template", label: "設定：テンプレート",   group: "screen" },
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
  // カレンダーは「タスクの一表示形式」から「コミュニティの予定表」へ性格が変わったため Community に置く
  { id: "community",    name: "Community",    jp: "コミュニティ", keys: ["calendar", "event_manage", "chat", "ai", "ai_consult"] },
  { id: "notification", name: "Notification", jp: "通知",         keys: ["notification", "notify", "chatwork"] },
  { id: "roadmap",      name: "Roadmap",      jp: "ロードマップ", keys: ["dashboard", "kanban", "gantt", "bulk_register"] },
  { id: "admin",        name: "Admin",        jp: "管理",         keys: ["broadcast", "scenario", "form", "master", "ai_draft"] },
  // 設定（マスタ）の各メニュー。master が ON のロールに対して、ここで更に個別に絞る。
  { id: "settings",     name: "Settings",     jp: "設定",         keys: ["set_member", "set_attribute", "set_news", "set_source", "set_welcome", "set_notify", "set_project", "set_anken", "set_template"] },
  { id: "payments",     name: "Payments",     jp: "決済",         keys: ["payment_manage", "payment_master", "payment_admin"] },
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
const OPS_EXCLUDE = ["ai_consult", "ai_html", "payment_admin"];
const ALLOW: Record<string, string[]> = {
  "管理者":       FEATURES.map((f) => f.key),
  "オペレーター": FEATURES.map((f) => f.key).filter((k) => !OPS_EXCLUDE.includes(k)),
  "メンバー":     ["home", "kanban", "gantt", "calendar", "content", "chat", "notification", "help", "ai_consult"],
  // 外部（メルマガ登録者など）はプロジェクト管理系を持たない。
  //   カンバン／ガントは RLS でデータが0件になるだけの空画面なので、そもそも出さない。
  "外部":         ["home", "content", "calendar", "notification", "help"],
};
// ⚠️ 既定値を持つのはシステム固定4ロールのみ。
//    派生ロールの初期値は copy_role_permissions()（派生元の設定を複製）で与える。
export const DEFAULT_PERMS: PermMap = (() => {
  const m: PermMap = {};
  for (const role of ROLES) for (const f of FEATURES) m[permKey(role, f.key)] = (ALLOW[role] ?? []).includes(f.key);
  return m;
})();

/** 派生ロール作成時に複製元となるロール（＝オペレーター）*/
export const COPY_SOURCE_ROLE = BASE_ROLE;

/**
 * 指定ロールが機能を使えるか（管理者は常時ON。未設定は既定値にフォールバック）
 *
 * ⚠️ 派生ロール（ロールマスタで追加したもの）は DEFAULT_PERMS を持たないため、
 *    role_permissions に行が無ければ false に倒れる（安全側）。
 *    そのためロール作成時は必ず copyRolePermissions() で初期値を投入すること。
 *    投入しないと「ログインしても何も表示されないロール」になる。
 */
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
