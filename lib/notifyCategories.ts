// ============================================================
// 通知カテゴリの共通定義（サーバー / クライアント共用）
//   - 11カテゴリのメタ情報と「既定テンプレート（見出し/前文/タスク行/末尾）」
//   - 文面は差込変数つきで編集可能。ここがコード側の最終フォールバック。
//   - lib/notify.ts（送信ロジック）と app.tsx（設定UI）の両方から import する。
// ============================================================

export type MentionKind = "all" | "leaderAssignee" | "assignee";
export type CategoryUnit = "project" | "assignee" | "projectCp";
export type DeadlineKind =
  | "overdue" | "weekDue" | "todayDue" | "weekCp" | "todayCp";

/** 4パートの文面テンプレート */
export interface TemplateParts {
  header: string;
  lead: string;
  taskLine: string;
  tail: string;
}
export type TemplateField = keyof TemplateParts;

export interface NotifyCategory {
  key: string;
  no: string;
  group: string;
  tabLabel: string;
  dl: DeadlineKind;
  imp: string | null;
  mention: MentionKind;
  unit: CategoryUnit;
  defaults: TemplateParts;
}

/** 汎用の文面上書き/設定オブジェクト（jsonb 由来のため緩め） */
export type TextOverride = Record<string, unknown> | null | undefined;

// 文面に使える差込変数（UIのヒント表示用）
export const VARS_GLOBAL: string[] = ["{プロジェクト名}", "{担当者}", "{日付}", "{曜日}"];
export const VARS_TASKLINE: string[] = ["{タスク名}", "{日付}", "{担当者}", "{重要度}"];
export const VARS_CPLINE: string[] = ["{番号}", "{名称}", "{日付}"];

// カテゴリ定義
export const CATEGORIES: NotifyCategory[] = [
  {
    key: "overdue3", no: "①", group: "overdue", tabLabel: "① ⛔🚨🚨🚨 期限超過（重要度Ⅲ）｜ALL・全件1通",
    dl: "overdue", imp: "3", mention: "all", unit: "project",
    defaults: { header: "⛔🚨🚨🚨 期限超過（重要度Ⅲ）｜{プロジェクト名}", lead: "", taskLine: "・{タスク名}（終了:{日付} / 担当:{担当者}）", tail: "" },
  },
  {
    key: "overdue12", no: "②", group: "overdue", tabLabel: "② ⛔🟠 期限超過（重要度Ⅰ〜Ⅱ）｜リーダー+担当・担当者毎",
    dl: "overdue", imp: "12", mention: "leaderAssignee", unit: "assignee",
    defaults: { header: "⛔🟠 期限超過（重要度Ⅰ〜Ⅱ）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}（終了:{日付}）", tail: "" },
  },
  {
    key: "overdue0", no: "③", group: "overdue", tabLabel: "③ ⛔⚪ 期限超過（重要度なし）｜担当・担当者毎",
    dl: "overdue", imp: "0", mention: "assignee", unit: "assignee",
    defaults: { header: "⛔⚪ 期限超過（重要度なし）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}（終了:{日付}）", tail: "" },
  },
  {
    key: "weekDue3", no: "④", group: "weekDue", tabLabel: "④ 📅🚨🚨🚨 今週期限（重要度Ⅲ）｜ALL・全件1通",
    dl: "weekDue", imp: "3", mention: "all", unit: "project",
    defaults: { header: "📅🚨🚨🚨 今週期限（重要度Ⅲ）｜{プロジェクト名}", lead: "", taskLine: "・{タスク名}（終了:{日付} / 担当:{担当者}）", tail: "" },
  },
  {
    key: "weekDue12", no: "⑤", group: "weekDue", tabLabel: "⑤ 📅🟠 今週期限（重要度Ⅰ〜Ⅱ）｜リーダー+担当・担当者毎",
    dl: "weekDue", imp: "12", mention: "leaderAssignee", unit: "assignee",
    defaults: { header: "📅🟠 今週期限（重要度Ⅰ〜Ⅱ）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}（終了:{日付}）", tail: "" },
  },
  {
    key: "weekDue0", no: "⑥", group: "weekDue", tabLabel: "⑥ 📅⚪ 今週期限（重要度なし）｜担当・担当者毎",
    dl: "weekDue", imp: "0", mention: "assignee", unit: "assignee",
    defaults: { header: "📅⚪ 今週期限（重要度なし）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}（終了:{日付}）", tail: "" },
  },
  {
    key: "todayDue3", no: "⑦", group: "todayDue", tabLabel: "⑦ ⏰🚨🚨🚨 本日期限（重要度Ⅲ）｜ALL・全件1通",
    dl: "todayDue", imp: "3", mention: "all", unit: "project",
    defaults: { header: "⏰🚨🚨🚨 本日期限（重要度Ⅲ）｜{プロジェクト名}", lead: "", taskLine: "・{タスク名}（担当:{担当者}）", tail: "" },
  },
  {
    key: "todayDue12", no: "⑧", group: "todayDue", tabLabel: "⑧ ⏰🟠 本日期限（重要度Ⅰ〜Ⅱ）｜リーダー+担当・担当者毎",
    dl: "todayDue", imp: "12", mention: "leaderAssignee", unit: "assignee",
    defaults: { header: "⏰🟠 本日期限（重要度Ⅰ〜Ⅱ）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}", tail: "" },
  },
  {
    key: "todayDue0", no: "⑨", group: "todayDue", tabLabel: "⑨ ⏰⚪ 本日期限（重要度なし）｜担当・担当者毎",
    dl: "todayDue", imp: "0", mention: "assignee", unit: "assignee",
    defaults: { header: "⏰⚪ 本日期限（重要度なし）｜{プロジェクト名}（担当: {担当者}）", lead: "", taskLine: "・{タスク名}", tail: "" },
  },
  {
    key: "weekCp", no: "⑩", group: "cp", tabLabel: "⑩ 🚩📅 今週チェックポイント｜ALL・PJ毎",
    dl: "weekCp", imp: null, mention: "all", unit: "projectCp",
    defaults: { header: "🚩📅 今週チェックポイント｜{プロジェクト名}", lead: "", taskLine: "・{番号} {名称}（{日付}）", tail: "" },
  },
  {
    key: "todayCp", no: "⑪", group: "cp", tabLabel: "⑪ 🚩⏰ 本日チェックポイント｜ALL・PJ毎",
    dl: "todayCp", imp: null, mention: "all", unit: "projectCp",
    defaults: { header: "🚩⏰ 本日チェックポイント｜{プロジェクト名}", lead: "", taskLine: "・{番号} {名称}", tail: "" },
  },
];

export const CAT_BY_KEY: Record<string, NotifyCategory> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const CATEGORY_KEYS: string[] = CATEGORIES.map((c) => c.key);

// テンプレート文字列の {変数} を実値に置換する。
export function renderTemplate(
  tpl: string | null | undefined,
  vars: Record<string, unknown> = {}
): string {
  return String(tpl ?? "").replace(/\{([^{}]+)\}/g, (_m, k: string) =>
    vars[k] != null ? String(vars[k]) : ""
  );
}

// 重要度ラベル（1→Ⅰ / 2→Ⅱ / 3→Ⅲ / それ以外→空）
export function importanceLabel(imp: number | null | undefined): string {
  return imp === 1 ? "Ⅰ" : imp === 2 ? "Ⅱ" : imp === 3 ? "Ⅲ" : "";
}

// 上書き(override) > アプリ全体(appSetting) > コード既定(defaults) の順で解決。
export function resolveTextField(
  field: string,
  def: string | null | undefined,
  override: TextOverride,
  appSetting: TextOverride
): string {
  const ov = override && override[field];
  if (ov != null && String(ov).length > 0) return String(ov);
  const ap = appSetting && appSetting[field];
  if (ap != null && String(ap).length > 0) return String(ap);
  return def ?? "";
}

// 通知ON/OFFを解決する。
export function resolveEnabled(override: TextOverride, appSetting: TextOverride): boolean {
  const mode = (override && (override["mode"] as string)) || "inherit";
  if (mode === "off") return false;
  if (mode === "on") return true;
  return !(appSetting && appSetting["enabled"] === false);
}
