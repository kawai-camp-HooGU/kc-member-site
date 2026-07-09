// 通知文面のクライアント側プレビュー生成
import { renderTemplate, resolveTextField } from "./notifyCategories";
import type { NotifyCategory, TemplateField, TextOverride } from "./notifyCategories";

// プレビュー用のサンプル差込値
export const NOTIFY_PREVIEW_VARS: Record<string, string> = {
  "プロジェクト名": "（例）PJ", "メンバー": "山田、佐藤",
  "日付": "2026-07-03", "曜日": "金",
  "タスク名": "（例）タスク名", "重要度": "Ⅲ",
  "番号": "①", "名称": "（例）チェックポイント名",
};

// カテゴリの解決済みテンプレ（appSetting + override → 既定）でプレビュー文面を生成
export function buildNotifyPreview(
  cat: NotifyCategory,
  appSetting: TextOverride,
  override: TextOverride
): string {
  const f = (field: TemplateField): string =>
    resolveTextField(field, cat.defaults[field], override, appSetting);
  const header = renderTemplate(f("header"), NOTIFY_PREVIEW_VARS);
  const lead   = renderTemplate(f("lead"),   NOTIFY_PREVIEW_VARS);
  const tail   = renderTemplate(f("tail"),   NOTIFY_PREVIEW_VARS);
  const lineTpl = f("taskLine");
  let rows: string[];
  if (cat.unit === "projectCp") {
    rows = [
      renderTemplate(lineTpl, { ...NOTIFY_PREVIEW_VARS, "番号": "①", "名称": "中間レビュー", "日付": "2026-07-03" }),
      renderTemplate(lineTpl, { ...NOTIFY_PREVIEW_VARS, "番号": "②", "名称": "最終確認", "日付": "2026-07-05" }),
    ];
  } else {
    rows = [
      renderTemplate(lineTpl, { ...NOTIFY_PREVIEW_VARS, "タスク名": "LP原稿チェック", "日付": "2026-07-03", "メンバー": "山田" }),
      renderTemplate(lineTpl, { ...NOTIFY_PREVIEW_VARS, "タスク名": "バナー入稿", "日付": "2026-07-04", "メンバー": "佐藤" }),
    ];
  }
  const mention = cat.mention === "all" ? "[toall]" : "[To:◯◯]";
  return [mention, `【${header}】`, ...(lead ? [lead] : []), ...rows, ...(tail ? [tail] : [])].join("\n");
}
