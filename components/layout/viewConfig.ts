export interface ViewDef { key: string; label: string; icon: string; }

export const VIEWS: ViewDef[] = [
  { key: "dashboard", label: "ダッシュボード", icon: "□" },
  { key: "kanban",    label: "カンバン",      icon: "⊞" },
  { key: "gantt",     label: "ガント",        icon: "≡" },
  { key: "calendar",  label: "カレンダー",    icon: "▦" },
  { key: "content",   label: "コンテンツ",    icon: "▷" },
  { key: "chat",      label: "チャット",      icon: "💬" },
  { key: "bulkadd",   label: "一括登録",      icon: "▤" },
  { key: "master",    label: "設定",          icon: "⚙" },
];

export const VIEW_TABS: ViewDef[] = [
  { key: "kanban",   label: "カンバン", icon: "⊞" },
  { key: "gantt",    label: "ガント",   icon: "≡" },
  { key: "calendar", label: "カレンダー", icon: "▦" },
];

export const FILTER_CHIP_META = {
  project:    { label: "プロジェクト", cls: "bg-blue-50 text-red-700 border-red-200" },
  anken:      { label: "分類",         cls: "bg-gray-100 text-gray-600 border-gray-200" },
  status:     { label: "ステータス",   cls: "bg-green-50 text-green-700 border-green-200" },
  assignee:   { label: "メンバー",     cls: "bg-purple-50 text-purple-700 border-purple-200" },
  importance: { label: "重要度",       cls: "bg-amber-50 text-amber-700 border-amber-200" },
} as const;
