// ============================================================
// UI 定数・設定（色・ラベル・スタイル）
// ============================================================
import type { CSSProperties } from "react";
import type { RiskLevel, TaskStatus } from "./database.types";
import type { Importance } from "./models";

export interface RiskStyle { label: string; badge: string; bar: string; dot: string; text: string; }
export const RISK_CONFIG: Record<RiskLevel, RiskStyle> = {
  high:    { label: "高リスク", badge: "bg-red-100 text-red-700 border-red-300",          bar: "bg-red-500",    dot: "bg-red-500",    text: "text-red-600"    },
  caution: { label: "注意",     badge: "bg-yellow-100 text-yellow-700 border-yellow-300", bar: "bg-yellow-400", dot: "bg-yellow-400", text: "text-yellow-600" },
  normal:  { label: "正常",     badge: "bg-green-100 text-green-700 border-green-300",    bar: "bg-green-500",  dot: "bg-green-400",  text: "text-green-600"  },
};

export interface StatusStyle { label: string; bar: string; }
export const STATUS_CONFIG: Record<TaskStatus, StatusStyle> = {
  completed:   { label: "完了",   bar: "bg-neutral-800" },
  in_progress: { label: "進行中", bar: "bg-green-500" },
  pending:     { label: "未着手", bar: "bg-gray-300" },
};

export interface ImportanceStyle {
  label: string; icon: string; chip: string; solid: string;
  hoverBorder: string; iconColor: string; ganttText: string; cardBg: string; cardBorder: string;
}
// 重要度（なし / Ⅰ / Ⅱ / Ⅲ）赤の濃淡（Ⅲが最重要・最濃）
export const IMPORTANCE_CONFIG: Record<Importance, ImportanceStyle> = {
  none: { label: "なし", icon: "",   chip: "bg-gray-100 text-gray-400", solid: "bg-gray-500 text-white border-gray-500",  hoverBorder: "hover:border-gray-400", iconColor: "text-gray-400", ganttText: "",             cardBg: "bg-white",   cardBorder: "border-gray-200" },
  1:    { label: "Ⅰ",   icon: "Ⅰ", chip: "bg-red-50 text-red-700",     solid: "bg-red-300 text-red-900 border-red-300",  hoverBorder: "hover:border-red-400",  iconColor: "text-red-400",  ganttText: "text-red-300", cardBg: "bg-red-50",  cardBorder: "border-red-200"  },
  2:    { label: "Ⅱ",   icon: "Ⅱ", chip: "bg-red-300 text-red-900",    solid: "bg-red-500 text-white border-red-500",    hoverBorder: "hover:border-red-400",  iconColor: "text-red-600",  ganttText: "text-red-500", cardBg: "bg-red-100", cardBorder: "border-red-300"  },
  3:    { label: "Ⅲ",   icon: "Ⅲ", chip: "bg-red-600 text-white",      solid: "bg-red-700 text-white border-red-700",    hoverBorder: "hover:border-red-400",  iconColor: "text-red-800",  ganttText: "text-red-600", cardBg: "bg-red-200", cardBorder: "border-red-400"  },
};

// 色塗りプルダウン用の白い▼矢印（appearance:none と併用）
export const SELECT_WHITE_ARROW: CSSProperties = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat", backgroundPosition: "right 9px center", backgroundSize: "10px",
};

// ステータス値 → 色塗りクラス（背景色＋白文字）
export const statusFillCls = (s: string): string =>
  s === "completed" ? "bg-neutral-800 text-white border-neutral-800" :
  s === "in_progress" ? "bg-green-500 text-white border-green-500" :
  "bg-gray-400 text-white border-gray-400";

// 重要度値 → 色塗りクラス（背景色＋白文字）
export const importanceFillCls = (impKey: string): string =>
  impKey === "1" ? "bg-red-400 text-white border-red-400" :
  impKey === "2" ? "bg-red-600 text-white border-red-600" :
  impKey === "3" ? "bg-red-700 text-white border-red-700" :
  "bg-gray-400 text-white border-gray-400";

export interface KanbanCol { key: TaskStatus; label: string; color: string; }
export const KANBAN_COLS: KanbanCol[] = [
  { key: "pending",     label: "未着手", color: "border-gray-300 bg-gray-50"   },
  { key: "in_progress", label: "進行中", color: "border-green-300 bg-green-50" },
  { key: "completed",   label: "完了",   color: "border-neutral-400 bg-neutral-100" },
];

// プロジェクト別カラー（6色循環）
export const PROJECT_BAR_COLORS = ["bg-red-600", "bg-neutral-800", "bg-red-800", "bg-neutral-500", "bg-rose-500", "bg-zinc-600"];
export const PROJECT_BADGE_STYLES = [
  "bg-red-50 text-red-700 border-red-200",
  "bg-neutral-100 text-neutral-700 border-neutral-300",
  "bg-red-100 text-red-800 border-red-300",
  "bg-neutral-50 text-neutral-600 border-neutral-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-zinc-100 text-zinc-700 border-zinc-300",
];
export const projectBar   = (id: number): string => PROJECT_BAR_COLORS[(id - 1) % PROJECT_BAR_COLORS.length]!;
export const projectBadge = (id: number): string => PROJECT_BADGE_STYLES[(id - 1) % PROJECT_BADGE_STYLES.length]!;

// ============================================================
// 管理画面の入力まわり共通スタイル
// ------------------------------------------------------------
//   ⚠️ 以前は同じクラス文字列が11ファイルにコピーされていて、
//      1か所直しても他が付いてこない状態だった。ここが唯一の正本。
//      新しい編集画面を作るときも、必ずこれを import して使うこと。
//
//   考え方（brand.md の「赤＝行動、無彩色が土台」に沿う）：
//     ・待機中の入力欄は薄グレーに沈める＝「まだ触っていない場所」
//     ・フォーカス中だけ地を白に戻し赤いリングを出す＝「今ここ」
//       白い上に白い入力欄だと境界が1pxの線しか無く、視線が定まらない。
//     ・ラベルは読ませる要素ではなく入力欄の名札。小さく薄くして、
//       視線が中身へ直行するようにする（見出しとの差を2段階に開く）。
// ============================================================

/** 入力欄（input / textarea / 全画面共通） */
export const FIELD_INPUT =
  "w-full rounded-lg px-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100";

/** 入力欄のラベル（名札） */
export const FIELD_LABEL =
  "block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5";

/** 小さいプルダウン（条件行・絞り込みなど） */
export const FIELD_SELECT =
  "rounded-lg px-2 py-1.5 text-[12px] bg-white border border-gray-200 " +
  "focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";

/** 白いカード（枠のみ。見出し帯を付ける場合は SettingCard を使う） */
export const CARD = "bg-white rounded-xl border border-gray-200";

/** カードの見出し帯（チャコール）。一覧の .tbl-head と同じ役割・同じ色 */
export const CARD_HEAD = "flex items-center gap-2 px-4 py-2.5 bg-[#3f3f46]";

/**
 * 状態チップの色ルール（画面をまたいで意味を固定する）
 *   on    … 設定が効いている（緑）
 *   off   … 今は使われていない（グレー）
 *   alert … 対応が必要（赤）
 * ⚠️ 「効いていない」を薄い文章で書かないこと。読み飛ばされて事故になる。
 */
export type StateKind = "on" | "off" | "alert";
export const STATE_CHIP: Record<StateKind, string> = {
  on:    "text-[10px] font-bold rounded-full px-2 py-0.5 bg-emerald-500 text-white",
  off:   "text-[10px] font-bold rounded-full px-2 py-0.5 bg-gray-400 text-white",
  alert: "text-[10px] font-bold rounded-full px-2 py-0.5 bg-red-600 text-white",
};

// 表示設定パネル共通スタイル（全画面で統一）
export const SET_LABEL = "text-[11px] font-semibold text-gray-500 mb-2 tracking-wide";
export const SET_SECTION = "border-t border-gray-100 pt-3";
export const setChip = (on: boolean): string =>
  `text-xs px-2.5 py-1 rounded-md border transition-colors ${on ? "border-red-300 bg-blue-50 text-red-600 font-medium" : "border-gray-200 bg-white text-gray-600 hover:border-red-300"}`;
