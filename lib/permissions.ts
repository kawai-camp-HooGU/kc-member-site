// ============================================================
// ロール権限マスタ（ロール × 機能）
//   機能の表示/利用可否をロールごとに制御。設定「権限」タブで編集。
// ============================================================
import { supabase } from "./supabase";
import type { MemberRole } from "./database.types";
import { allRoleKeys, SYSTEM_ROLES, BASE_ROLE, isStaffRole } from "./roles";

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

/**
 * 適用範囲。ロールによっては「概念として存在しない」機能があるため、
 * その組み合わせは権限表でトグルを出さず「－」を表示する。
 *
 *   ops    … 運営専用（会員ロールには適用されない）
 *   member … 会員専用（運営ロールには適用されない）
 *   both   … 双方に存在する
 *
 * ⚠️ ops の判定は lib/zone.ts の OPS_VIEWS（ゾーンによる出し分け）と
 *    一致させること。ここが食い違うと「ONにしたのに表示されない」という
 *    設定と実態の乖離が生まれる。
 */
export type FeatureScope = "ops" | "member" | "both";

export interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
  scope: FeatureScope;
  /** 親となる画面キー。機能（func）を画面にぶら下げて表示するために使う */
  parent?: string;
}

export const FEATURES: FeatureDef[] = [
  // ── 共通の画面 ──────────────────────────────────────────
  { key: "home",          label: "ホーム",           group: "screen", scope: "both" },
  { key: "help",          label: "ヘルプ",           group: "screen", scope: "both" },

  // ── コンテンツ ──────────────────────────────────────────
  { key: "content",        label: "コンテンツ",                     group: "screen", scope: "both" },
  { key: "content_manage", label: "コンテンツ設定",                 group: "func",   scope: "ops",    parent: "content" },
  // ⚠️ コンテンツ専用ではない。お知らせ・フォームの完了画面HTMLでも同じキーで出し分ける
  { key: "ai_html",        label: "AI HTMLコード生成",               group: "func",   scope: "ops",    parent: "content" },

  // ── コミュニティ ────────────────────────────────────────
  { key: "calendar",     label: "カレンダー",                       group: "screen", scope: "both" },
  { key: "event_manage", label: "イベント・予定の管理",             group: "func",   scope: "ops",    parent: "calendar" },
  { key: "chat",         label: "チャット",                         group: "screen", scope: "both" },
  // ⚠️ ブックマークは長らく chat キーを流用していた（運営専用ビューなのに会員キーに相乗り）。
  //    チャットをOFFにするとブックマークも巻き添えで消える不具合があったため独立キーにした。
  { key: "bookmarks",    label: "ブックマーク",                     group: "screen", scope: "ops" },
  { key: "ai",           label: "AIアシスタント（スタッフ返信支援）", group: "func",  scope: "ops",    parent: "chat" },
  { key: "ai_consult",   label: "AI相談チャット（メンバー）",        group: "func",  scope: "member", parent: "chat" },

  // ── 通知 ────────────────────────────────────────────────
  { key: "notification", label: "通知設定",           group: "screen", scope: "both" },
  { key: "notify",       label: "通知",               group: "func",   scope: "both", parent: "notification" },
  { key: "chatwork",     label: "チャットワーク通知", group: "func",   scope: "ops",  parent: "notification" },

  // ── ロードマップ ────────────────────────────────────────
  { key: "dashboard",     label: "ダッシュボード", group: "screen", scope: "both" },
  { key: "kanban",        label: "カンバン",       group: "screen", scope: "both" },
  { key: "gantt",         label: "ガント",         group: "screen", scope: "both" },
  { key: "bulk_register", label: "一括登録",       group: "screen", scope: "ops" },

  // ── 運営（Admin）────────────────────────────────────────
  { key: "broadcast", label: "一斉配信",                   group: "screen", scope: "ops" },
  { key: "ai_draft",  label: "AI 配信原稿生成（一斉配信）", group: "func",   scope: "ops", parent: "broadcast" },
  { key: "scenario",  label: "シナリオ配信",               group: "screen", scope: "ops" },
  { key: "form",      label: "フォーム",                   group: "screen", scope: "ops" },
  { key: "master",    label: "設定（マスタ管理）",         group: "screen", scope: "ops" },

  // ── 決済 ────────────────────────────────────────────────
  // ⚠️ payment_manage は /ops/payments という「画面」の出し分けに使われている。
  //    以前は group: "func" だったが実態と合わないため screen に修正した。
  { key: "payment_manage", label: "決済",                       group: "screen", scope: "ops" },
  { key: "payment_master", label: "決済マスタの編集",           group: "func",   scope: "ops", parent: "payment_manage" },
  { key: "payment_admin",  label: "決済スクショ閲覧・完全削除", group: "func",   scope: "ops", parent: "payment_manage" },

  // ── 設定（マスタ）の各メニュー ──────────────────────────
  //   「設定」全体は master で出し分けるが、その中のメニュー1つ1つを更に絞れるようにする。
  //   ※ コンテンツ設定＝content_manage、イベント・予定の管理＝event_manage を流用する（重複キーを作らない）。
  // ⚠️ 「設定：権限」を ON にしたロールは権限マスタそのものを編集できる。
  //    ただし運営側ロールの列は編集できない（canEditRoleColumn / RLS で二重に制限）。
  { key: "set_permission", label: "設定：権限",           group: "screen", scope: "ops", parent: "master" },
  { key: "set_role",       label: "設定：ロール",         group: "screen", scope: "ops", parent: "master" },
  { key: "set_member",     label: "設定：メンバー",       group: "screen", scope: "ops", parent: "master" },
  { key: "set_attribute",  label: "設定：属性",           group: "screen", scope: "ops", parent: "master" },
  { key: "set_news",       label: "設定：お知らせ",       group: "screen", scope: "ops", parent: "master" },
  { key: "set_source",     label: "設定：流入経路",       group: "screen", scope: "ops", parent: "master" },
  { key: "set_welcome",    label: "設定：初回メッセージ", group: "screen", scope: "ops", parent: "master" },
  { key: "set_notify",     label: "設定：通知の文面",     group: "screen", scope: "ops", parent: "master" },
  { key: "set_project",    label: "設定：プロジェクト",   group: "screen", scope: "ops", parent: "master" },
  { key: "set_anken",      label: "設定：分類（案件）",   group: "screen", scope: "ops", parent: "master" },
  { key: "set_template",   label: "設定：テンプレート",   group: "screen", scope: "ops", parent: "master" },
];

/**
 * そのロールにこの機能が適用されるか。false なら権限表で「－」を表示する。
 *
 * ⚠️ isStaffRole() を使うため、派生ロールは自動的に「運営」として扱われる。
 *    ロールを増やしても scope の定義を変更する必要はない。
 */
export function appliesTo(f: FeatureDef, role: string): boolean {
  if (f.scope === "both") return true;
  return f.scope === "ops" ? isStaffRole(role) : !isStaffRole(role);
}
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
  //   ⚠️ 並び順は「画面 → その画面にぶら下がる機能」にすること。
  //      権限表は parent でインデント表示するため、順序が崩れると親子が離れて読みにくくなる。
  { id: "community",    name: "Community",    jp: "コミュニティ", keys: ["calendar", "event_manage", "chat", "ai", "ai_consult", "bookmarks"] },
  { id: "notification", name: "Notification", jp: "通知",         keys: ["notification", "notify", "chatwork"] },
  { id: "roadmap",      name: "Roadmap",      jp: "ロードマップ", keys: ["dashboard", "kanban", "gantt", "bulk_register"] },
  { id: "admin",        name: "Admin",        jp: "管理",         keys: ["broadcast", "ai_draft", "scenario", "form", "master"] },
  // 設定（マスタ）の各メニュー。master が ON のロールに対して、ここで更に個別に絞る。
  { id: "settings",     name: "Settings",     jp: "設定",         keys: ["set_permission", "set_role", "set_member", "set_attribute", "set_news", "set_source", "set_welcome", "set_notify", "set_project", "set_anken", "set_template"] },
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

export const ADMIN_ROLE = "管理者";
export const isAdminRole = (role: string): boolean => role === ADMIN_ROLE;

/**
 * 管理者でも OFF にできない機能（ロックアウト防止）。
 *
 * ⚠️ これを外すと、管理者が自分で「設定」を OFF にした瞬間に
 *    設定画面へ二度と入れなくなり、SQL を直接実行する以外に
 *    復旧手段がなくなる。必ずロックしたまま運用すること。
 */
export const ADMIN_LOCKED_FEATURES: readonly string[] = ["master", "home"];
export const isAdminLocked = (feature: string): boolean =>
  ADMIN_LOCKED_FEATURES.includes(feature);

/**
 * 権限表に表示するロール列。
 *   管理者列は管理者本人にだけ見せる（オペレーターには非表示）。
 */
export function visibleRoleColumns(viewerIsAdmin: boolean): string[] {
  const cols = roleColumns();
  return viewerIsAdmin ? cols : cols.filter((r) => !isAdminRole(r));
}

/**
 * 閲覧者がそのロール列を編集できるか。
 *
 * ⚠️ オペレーターは「会員側ロール（メンバー・外部）」しか編集できない。
 *    運営側ロール（オペレーター・その派生）の権限を触れると、
 *    自分自身の権限を拡張できてしまう（権限昇格）。
 *    サーバー側も role_permissions の RLS で同じ条件を課すこと。
 */
export function canEditRoleColumn(viewerIsAdmin: boolean, targetRole: string): boolean {
  if (viewerIsAdmin) return true;
  return !isStaffRole(targetRole);
}

/** `${role}::${feature}` → enabled のマップ */
export type PermMap = Record<string, boolean>;
export const permKey = (role: string, feature: string): string => `${role}::${feature}`;

// 既定値（管理者/オペレーター=ほぼ全て、メンバー/外部=閲覧系のみ）
//   ai_consult … メンバー向けのAI相談。スタッフ画面には出さない
//   ai_html    … コンテンツ本文HTMLの生成。サーバー側は requireAdmin のため管理者のみ
//   set_permission / set_role … 権限設計そのものを触るメニュー。既定は管理者のみ。
//     必要なら管理者が［権限］タブでオペレーターの「設定：権限」を ON にして開放する。
const OPS_EXCLUDE = ["ai_consult", "ai_html", "payment_admin", "set_permission", "set_role"];
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
  // 管理者は「設定」「ホーム」だけ常時ON。それ以外は権限マスタに従う。
  //   （既定値 DEFAULT_PERMS は管理者=全機能ONなので、明示的にOFFにするまで挙動は変わらない）
  if (isAdminRole(role) && isAdminLocked(feature)) return true;
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
