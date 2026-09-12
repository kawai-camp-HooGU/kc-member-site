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
// ガント：バー色は「重要度（赤の濃淡）」で表す（案B ダークキャンバス前提）
// ------------------------------------------------------------
//   以前はバーをプロジェクト別6色（PROJECT_BAR_COLORS）で塗っていたが、
//   チャート上で「何が急ぎか（重要度）」が色から読めなかった。
//   ブランド規定「赤の濃淡で強弱／無彩色を土台」に合わせ、
//   バー色＝重要度に一元化する。プロジェクト識別は左カラムの
//   バッジ（projectBadge）へ委ねる。発光（globals.css の .gbar-glow-*）は
//   ダークキャンバスでのみ効かせ、重要度の序列を強調する。
// ============================================================
export const IMPORTANCE_BAR_COLORS: Record<Importance, string> = {
  none: "bg-zinc-500",
  1:    "bg-red-400",
  2:    "bg-red-500",
  3:    "bg-red-700",
};
export const importanceBar = (imp: Importance): string => IMPORTANCE_BAR_COLORS[imp ?? "none"];

// ガントのチャート地色（案B：ダーク×赤発光 / ライトも選択可）。既定はダーク。
export type GanttCanvas = "light" | "dark";
export const GANTT_CANVAS_DEFAULT: GanttCanvas = "dark";

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

// ============================================================
// ロードマップのサブマスタで使う色
// ------------------------------------------------------------
//   ⚠️ brand.md §1-1「赤を主役、無彩色を土台にする。多色は使わず、赤の濃淡で
//      強弱を表現する」に従い、パレットは赤系＋無彩色に限定する。
//      土台アプリ（ProgressBoard）は青・緑・紫を使っているが、そちらへ寄せない。
//   ⚠️ ロゴのブランドレッド #ee1c25 は識別子。ここには入れない（brand.md §7）。
// ============================================================

export interface ColorChoice { value: string; label: string }

/** プロジェクト区分の色パレット（設定 ＞ プロジェクト ＞ 区分編集） */
export const CATEGORY_COLORS: ColorChoice[] = [
  { value: "#dc2626", label: "レッド" },       // red-600
  { value: "#b91c1c", label: "ダークレッド" }, // red-700
  { value: "#f87171", label: "ライトレッド" }, // red-400
  { value: "#e11d48", label: "ローズ" },       // rose-600
  { value: "#3f3f46", label: "チャコール" },   // zinc-700
  { value: "#71717a", label: "グレー" },       // zinc-500
];
export const CATEGORY_COLOR_DEFAULT = "#dc2626";

/**
 * フェーズ進捗ステータスの色パレット。
 *   ⚠️ ここだけは STATUS_CONFIG（タスクのステータス色）と意味を揃える必要があるため、
 *      グリーン／アンバーを例外的に許可する。「進行中は緑」がタスク側と食い違うと、
 *      同じ画面に緑と赤の進行中が並んで読めなくなる。
 */
export const PHASE_STATUS_COLORS: ColorChoice[] = [
  { value: "#a1a1aa", label: "グレー（未着手）" },   // zinc-400
  { value: "#22c55e", label: "グリーン（進行中）" }, // green-500
  { value: "#f59e0b", label: "アンバー（待ち）" },   // amber-500
  { value: "#dc2626", label: "レッド（要対応）" },   // red-600
  { value: "#3f3f46", label: "チャコール（完了）" }, // zinc-700
];
export const PHASE_STATUS_COLOR_DEFAULT = "#a1a1aa";

/**
 * 区分チップ / ステータスチップ。
 *   マスタの色は自由入力の #RRGGBB なので Tailwind クラスに落とせない。
 *   地は 14% 程度の透過、文字とドットは原色、という組み立てをここに集約する。
 */
export const chipStyle = (color: string): { backgroundColor: string; color: string } => ({
  backgroundColor: `${color}1f`,   // 末尾2桁は alpha（1f ≒ 12%）
  color,
});

/** 一覧の行頭に置く色バー（4px） */
export const rowBarStyle = (color: string | null): { backgroundColor: string } => ({
  backgroundColor: color ?? "#e5e7eb",
});

/**
 * 「本文中のリンク」カード。
 *   自由入力の本文（進捗メモ・特記事項・資料など）から拾った URL を並べる。
 *   ⚠️ アイコンは Icon / IconBadge を通す（brand.md §6：生の絵文字を直書きしない）。
 *   ⚠️ 赤はアクセント。ホバーの薄赤は「押せる」を示すためで、危険色ではない。
 */
export const LINKCARD = {
  /** 見出し（「本文中のリンク（N件）」） */
  head: "text-xs font-semibold text-gray-500 mb-1.5",
  /** カードの縦積み */
  list: "flex flex-col gap-1.5",
  /** 1件ぶんのカード（<a> に付ける） */
  item: "group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 " +
        "hover:border-red-300 hover:bg-red-50 transition-colors",
  /** ホスト名（見出し行） */
  host: "block text-sm font-bold text-gray-800 truncate",
  /** ホスト＋パス（副見出し行） */
  url:  "block text-xs text-gray-400 truncate",
  /** 右端の「外部リンク」アイコン */
  arrow: "shrink-0 text-gray-300 group-hover:text-red-600 transition-colors",
} as const;

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

// ============================================================
// 成功・完了の配色（brand.md §4「完了・成功」の実体）
// ------------------------------------------------------------
//   ⚠️ brand.md は「成功色は lib/constants.ts に集約」と書いていたが、
//      実体が無いまま画面側に緑を直書きする状態が続いていた。
//      REQ-027（運営ダッシュボードの空状態）で初めて実体を作る。
//      以降、完了・成功の緑はすべてここを参照すること。
// ============================================================
export interface SuccessStyle { bg: string; border: string; text: string; icon: string; solid: string; }
export const SUCCESS_CONFIG: SuccessStyle = {
  bg:     "bg-emerald-50",
  border: "border-emerald-200",
  text:   "text-emerald-700",
  icon:   "text-emerald-600",
  solid:  "bg-emerald-500 text-white",
};

// ============================================================
// 運営ダッシュボード（REQ-027）
// ------------------------------------------------------------
//   ⚠️ 画面側に生の色クラス・色値を直書きしないこと（brand.md §7）。
//      しきい値も含めてここが唯一の正本。
//
//   ⚠️ 未対応の警告は「アクセントの red-*」で表す。危険色（削除・不可逆操作）
//      とは意味が違うので混ぜない（brand.md §1-2）。
// ============================================================

/** KPI カードのトーン */
export type KpiTone = "alert" | "calm" | "plain";
export interface KpiToneStyle { card: string; label: string; value: string; }
export const KPI_TONE: Record<KpiTone, KpiToneStyle> = {
  alert: { card: "bg-red-50 border-red-200",           label: "text-red-700",     value: "text-red-600"     },
  calm:  { card: "bg-emerald-50 border-emerald-200",   label: "text-emerald-700", value: "text-emerald-600" },
  plain: { card: "bg-white border-gray-200",           label: "text-gray-400",    value: "text-gray-700"    },
};

/** チャネルの識別色（アイコンの地）。LINE の緑はブランド識別で、機能色には流用しない */
export const DASH_CHANNEL_FILL: Record<"portal" | "mail" | "line" | "form", string> = {
  portal: "bg-red-600 text-white",
  mail:   "bg-slate-500 text-white",
  line:   "bg-[#06c755] text-white",
  form:   "bg-blue-600 text-white",
};

/** 未対応バッジ（0件は淡色に沈める） */
export const unhandledBadgeCls = (n: number): string =>
  n > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-400";

/**
 * 待ち時間のしきい値（ミリ秒）と表示色。
 * ⚠️ 「何時間で赤くするか」を画面側に散らかさない。運用で変える値はここだけ。
 */
export const WAIT_THRESHOLD = { warn: 12 * 3_600_000, danger: 24 * 3_600_000 };
export const waitCls = (ms: number): string =>
  ms >= WAIT_THRESHOLD.danger ? "text-red-600"
  : ms >= WAIT_THRESHOLD.warn ? "text-amber-600"
  : "text-gray-500";

/** 推移グラフの棒（P1 はフォームのみの単色。P2 でチャネル別に割る） */
export const TREND_BAR = "bg-red-600";

// ── リスト管理（REQ-049）──────────────────────────────────────
/**
 * ラベルのチップ。
 * ⚠️ グレー系に固定する。ラベルは分類であって重要度でも危険でもないので、
 *    `red-*`（アクセント）も危険色も使わない（brand.md §1-2）。
 */
export const labelChipCls =
  "bg-gray-100 text-gray-600 border-gray-200";

/** 一覧の展開行：項目名 */
export const DETAIL_LABEL =
  "text-[9.5px] font-bold text-gray-400 tracking-wider";
/** 一覧の展開行：値 */
export const DETAIL_VALUE =
  "text-[11px] text-gray-700 break-all";

/** 推移グラフの期間の選択肢と既定 */
export const TREND_RANGES: readonly number[] = [7, 14, 30];
export const TREND_RANGE_DEFAULT = 14;

/** ダッシュボードの自動更新間隔（ミリ秒）。タブが前面のときだけ回す */
export const DASH_REFRESH_MS = 60_000;

// ── チャットの添付ファイルカードの配色 ────────────────────────
//   青塗りの吹き出し（運営の手動返信）の上では、白の半透明バッジだと
//   地に溶けて「小さな青い四角」にしか見えなかったため、白地＋青文字にする。
export interface FileCardStyle { badge: string; name: string; size: string; icon: string; }
export const FILECARD_STYLE: Record<"painted" | "plain", FileCardStyle> = {
  // painted＝青い吹き出しの上
  painted: { badge: "bg-white text-[#2E6FB4]", name: "text-white", size: "text-white/80", icon: "text-white/90" },
  // plain＝白い吹き出し／塗りなしの上
  plain:   { badge: "bg-red-600 text-white",   name: "text-gray-800", size: "text-gray-400", icon: "text-gray-500" },
};
