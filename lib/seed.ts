// ============================================================
// 初期データ（デモ/フォールバック値）
// App の useState 初期値。マウント直後に fetchAllData() で上書きされる。
// 生データ(RAW_*)は必須フィールドの一部のみ持つため、ビルダーで既定値を補完して
// ドメイン型（Project/Anken/Task/Member/Template）に適合させる。
// ============================================================
import type { Project, Anken, Task, Member, Template, Role, Status, Risk } from "./models";

export const PROJECT_NAME = "WLF";
export const MEMBER_ROLES: Role[] = ["管理者", "オペレーター", "メンバー", "外部"];

// 権限早見表（メンバーマスタ画面で表示）
export interface PermRow { f: string; v: { t: string; c: string }[]; }

type SeedProject = Pick<Project,
  "id" | "name" | "startDate" | "progress" | "risk" | "dueDate" |
  "lastUpdated" | "tasksDueThisWeek" | "tasksDelayed" | "tasksCompleted" | "memberNames">;
type SeedAnken = Pick<Anken,
  "id" | "projectId" | "name" | "leader" | "progress" | "risk" | "dueDate" |
  "lastUpdated" | "tasksDueThisWeek" | "tasksDelayed" | "tasksCompleted">;
type SeedTask = Pick<Task,
  "id" | "projectId" | "ankenId" | "name" | "assignees" | "start" | "end" |
  "status" | "risk" | "progressMemo" | "specialNotes" | "materials">;
type SeedMember = Pick<Member, "name" | "role">;
interface SeedTemplateRaw {
  id: number;
  name: string;
  anken: { name: string; tasks: { name: string; startOffset: number; endOffset: number }[] }[];
}

const RAW_PROJECTS: SeedProject[] = [
  { id: 1, name: "WLF",      startDate: "2026-06-01", progress: 1,   risk: "high",    dueDate: "2027-01-04", lastUpdated: "2026-06-16", tasksDueThisWeek: 13, tasksDelayed: 0, tasksCompleted: 1,  memberNames: [] },
  { id: 2, name: "AI_kawai", startDate: "2026-05-01", progress: 0.4, risk: "caution", dueDate: "2026-06-30", lastUpdated: "2026-06-16", tasksDueThisWeek: 5,  tasksDelayed: 0, tasksCompleted: 11, memberNames: [] },
];

const RAW_ANKEN: SeedAnken[] = [
  { id: 1,  projectId: 1, name: "共通",                               leader: "SAI奥山", progress: 0,   risk: "high",    dueDate: "2027-01-04", lastUpdated: "2026-06-16", tasksDueThisWeek: 10, tasksDelayed: 0, tasksCompleted: 0 },
  { id: 2,  projectId: 1, name: "スクール",                           leader: "SAI奥山", progress: 0,   risk: "high",    dueDate: "2026-08-21", lastUpdated: "2026-06-16", tasksDueThisWeek: 2,  tasksDelayed: 0, tasksCompleted: 0 },
  { id: 3,  projectId: 1, name: "システム",                           leader: "SAI奥山", progress: 3,   risk: "high",    dueDate: "2026-08-31", lastUpdated: "2026-06-16", tasksDueThisWeek: 1,  tasksDelayed: 0, tasksCompleted: 1 },
  { id: 4,  projectId: 2, name: "PHASE 1 – ヒアリング・リサーチ・コンセプト設計", leader: "柴田", progress: 1, risk: "normal",  dueDate: "2026-06-10", lastUpdated: "2026-06-16", tasksDueThisWeek: 0,  tasksDelayed: 0, tasksCompleted: 7 },
  { id: 5,  projectId: 2, name: "PHASE 2 – セミナー設計・チーム構築",   leader: "柴田", progress: 1,   risk: "normal",  dueDate: "2026-05-31", lastUpdated: "2026-06-16", tasksDueThisWeek: 0,  tasksDelayed: 0, tasksCompleted: 4 },
  { id: 6,  projectId: 2, name: "PHASE 3 – クリエイティブ制作",         leader: "柴田", progress: 0.6, risk: "caution", dueDate: "2026-06-30", lastUpdated: "2026-06-16", tasksDueThisWeek: 4,  tasksDelayed: 0, tasksCompleted: 2 },
  { id: 7,  projectId: 2, name: "PHASE 4 – 入稿・テスト・スタート",     leader: "広告", progress: 0.2, risk: "high",    dueDate: "2026-06-30", lastUpdated: "2026-06-16", tasksDueThisWeek: 1,  tasksDelayed: 0, tasksCompleted: 0 },
  { id: 8,  projectId: 2, name: "法人関連",                           leader: "森岡", progress: 0,   risk: "caution", dueDate: "2026-06-16", lastUpdated: "2026-06-16", tasksDueThisWeek: 0,  tasksDelayed: 0, tasksCompleted: 0 },
  { id: 9,  projectId: 2, name: "インフラ関連",                       leader: "",     progress: 0,   risk: "normal",  dueDate: "2026-06-16", lastUpdated: "2026-06-16", tasksDueThisWeek: 0,  tasksDelayed: 0, tasksCompleted: 0 },
  { id: 10, projectId: 2, name: "広告関連",                           leader: "",     progress: 0,   risk: "normal",  dueDate: "2026-06-16", lastUpdated: "2026-06-16", tasksDueThisWeek: 0,  tasksDelayed: 0, tasksCompleted: 0 },
];

const RAW_TASKS: SeedTask[] = [
  { id: 1, projectId: 1, ankenId: 1, name: "HP用ドメイン準備", assignees: ["SAI奥山", "SAI野々山"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 2, projectId: 1, ankenId: 1, name: "HP準備", assignees: ["SAI奥山", "SAI野々山"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 3, projectId: 1, ankenId: 1, name: "HPドメインメールアドレス発行", assignees: ["SAI奥山", "SAI野々山"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 4, projectId: 1, ankenId: 2, name: "会員サイト譲渡条件確認", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-19", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 5, projectId: 1, ankenId: 2, name: "会員サイト引き継ぎ対応", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-16", end: "2026-06-19", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 6, projectId: 1, ankenId: 2, name: "会員サイト準備/改修", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-19", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 7, projectId: 1, ankenId: 2, name: "会員引き継ぎ対応", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 8, projectId: 1, ankenId: 2, name: "顧客サポート対応フロー作成", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 9, projectId: 1, ankenId: 2, name: "着金誘導フロー設計/確認", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 10, projectId: 1, ankenId: 2, name: "カスタマージャーニー作成", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-07-20", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 11, projectId: 1, ankenId: 2, name: "顧客管理シート作成（受講生/卒業生）", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-17", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 12, projectId: 1, ankenId: 2, name: "撮影手配（MC/会場/STAFF手配）", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-22", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 13, projectId: 1, ankenId: 2, name: "【10周年イベント】LINEアカウント準備", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-08", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 14, projectId: 1, ankenId: 2, name: "【10周年イベント】配信スタンドの準備（エルメ）", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-08", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 15, projectId: 1, ankenId: 2, name: "オンライン講師引き継ぎ対応", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-08-21", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 16, projectId: 1, ankenId: 2, name: "オンラインセミナー企画", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-08-21", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 17, projectId: 1, ankenId: 2, name: "返金用電話番号取得", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-08-21", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 18, projectId: 1, ankenId: 2, name: "返金/クーリングオフ対応フロー構築", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-08-21", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 19, projectId: 1, ankenId: 1, name: "CSメンバーマネジメント設計", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 20, projectId: 1, ankenId: 3, name: "システム仕様書作成", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-16", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 21, projectId: 1, ankenId: 3, name: "開発依頼", assignees: ["SAI奥山", "SAI吉田"], start: "2026-06-15", end: "2026-06-19", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 22, projectId: 1, ankenId: 3, name: "よくある質問Q＆A用意", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 23, projectId: 1, ankenId: 3, name: "商品提供導線設計", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-07", end: "2026-07-24", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 24, projectId: 1, ankenId: 3, name: "商品提供フロー構築（スタッフ側）", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-20", end: "2026-07-21", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 25, projectId: 1, ankenId: 3, name: "動画撮影スタッフの用意", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 26, projectId: 1, ankenId: 3, name: "プレCS最終調整", assignees: ["SAI奥山", "SAI吉田"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 27, projectId: 1, ankenId: 3, name: "プレCS対応", assignees: ["SAI奥山", "SAI吉田"], start: "2026-08-03", end: "2026-08-07", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 28, projectId: 1, ankenId: 3, name: "本リリースCS最終調整", assignees: ["SAI奥山", "SAI吉田"], start: "2026-08-10", end: "2026-08-14", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 29, projectId: 1, ankenId: 3, name: "本リリースCS対応", assignees: ["SAI奥山", "SAI吉田"], start: "2026-08-31", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 30, projectId: 1, ankenId: 1, name: "事業計画・経営戦略の策定", assignees: ["SAI吉田", "SAI浜口"], start: "2026-06-17", end: "2026-06-19", status: "pending", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 31, projectId: 1, ankenId: 1, name: "組織図/役割確定", assignees: ["SAI吉田", "SAI浜口"], start: "2026-06-17", end: "2026-06-19", status: "pending", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 32, projectId: 1, ankenId: 1, name: "台帳構築（PL/KPI管理）", assignees: ["SAI吉田", "SAI浜口"], start: "2026-06-22", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 33, projectId: 1, ankenId: 1, name: "商品コンプラチェック", assignees: ["SAI吉田", "SAI阿部"], start: "2026-06-17", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 34, projectId: 1, ankenId: 1, name: "プロモーションコンプラチェック", assignees: ["SAI吉田", "SAI阿部"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 35, projectId: 1, ankenId: 1, name: "クロージングコンプラチェック", assignees: ["SAI吉田", "SAI阿部"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 36, projectId: 1, ankenId: 1, name: "コンプラ線引き", assignees: ["SAI吉田", "SAI阿部"], start: "2026-06-17", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 37, projectId: 1, ankenId: 1, name: "記念イベント企画設計", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 38, projectId: 1, ankenId: 1, name: "記念イベント運営業者手配", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-12", end: "2026-06-16", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 39, projectId: 1, ankenId: 1, name: "記念イベントアンケート文作成", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-12", end: "2026-06-16", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 40, projectId: 1, ankenId: 1, name: "記念イベント案内文作成", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-12", end: "2026-06-16", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 41, projectId: 1, ankenId: 1, name: "AIチャットボット企画（Gem）", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-01", end: "2026-06-16", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 42, projectId: 1, ankenId: 1, name: "AIチャットボットテスト（社内）", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-06-19", status: "pending", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 43, projectId: 1, ankenId: 1, name: "AIチャットボットテスト（PJT）", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-19", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 44, projectId: 1, ankenId: 1, name: "スクール商品企画", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 45, projectId: 1, ankenId: 1, name: "システム商品企画", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 46, projectId: 1, ankenId: 1, name: "システムバックテスト実施/指標設定", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 47, projectId: 1, ankenId: 1, name: "システム制作業者選定", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-06-19", status: "pending", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 48, projectId: 1, ankenId: 1, name: "システム制作", assignees: ["SAI吉田", "SAI山嵜"], start: "2026-06-17", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 49, projectId: 1, ankenId: 1, name: "クロスセル準備", assignees: ["SAI吉田", "SAI柴垣"], start: "2026-08-01", end: "2026-08-28", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 50, projectId: 1, ankenId: 1, name: "SNS告知スケジュール調整", assignees: ["SAI吉田", "SAI柴垣"], start: "2026-07-01", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 51, projectId: 1, ankenId: 1, name: "外部講師の用意", assignees: ["SAI吉田", "SAI柴垣"], start: "2026-06-15", end: "2026-06-16", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 52, projectId: 1, ankenId: 1, name: "各社契約締結", assignees: ["SAI吉田", "SAI柴垣"], start: "2026-06-17", end: "2026-06-26", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 53, projectId: 1, ankenId: 2, name: "引き継ぎ準備", assignees: ["SAI吉田", "SAI奥山"], start: "2026-06-17", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 54, projectId: 1, ankenId: 2, name: "引き継ぎ対応", assignees: ["SAI吉田", "SAI奥山"], start: "2026-07-01", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 55, projectId: 1, ankenId: 1, name: "月刊ウルフ/準備", assignees: ["SAI吉田", "SAI奥山"], start: "2026-06-17", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 56, projectId: 1, ankenId: 1, name: "月刊ウルフ/引き継ぎ対応", assignees: ["SAI吉田", "SAI奥山"], start: "2026-07-01", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 57, projectId: 1, ankenId: 3, name: "プレPJT最終調整", assignees: ["SAI吉田", "SAI奥山"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 58, projectId: 1, ankenId: 3, name: "プレPJT対応", assignees: ["SAI吉田", "SAI奥山"], start: "2026-08-01", end: "2026-08-07", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 59, projectId: 1, ankenId: 3, name: "本リリースPJT最終調整", assignees: ["SAI吉田", "SAI奥山"], start: "2026-08-10", end: "2026-08-14", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 60, projectId: 1, ankenId: 3, name: "本リリースPJT対応", assignees: ["SAI吉田", "SAI奥山"], start: "2026-08-31", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 61, projectId: 1, ankenId: 1, name: "株トレ基礎講座視聴・理解", assignees: ["ALL", "ALL奥山"], start: "2026-06-15", end: "2026-06-26", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 62, projectId: 1, ankenId: 2, name: "システム商品理解", assignees: ["ALL", "ALL奥山"], start: "2026-06-15", end: "2026-06-26", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 63, projectId: 1, ankenId: 1, name: "SNS運用準備", assignees: ["SAI吉田", "SAI浜口"], start: "2026-08-01", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 64, projectId: 1, ankenId: 1, name: "SNS運用管理引き継ぎ", assignees: ["SAI吉田", "SAI浜口"], start: "2026-09-01", end: "2026-09-01", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 65, projectId: 1, ankenId: 1, name: "WEB広告集客準備", assignees: ["SAI吉田", "SAI浜口"], start: "2026-08-01", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 66, projectId: 1, ankenId: 1, name: "コード別成果表作成", assignees: ["SAI吉田", "SAI浜口"], start: "2026-09-01", end: "2026-09-15", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 67, projectId: 1, ankenId: 1, name: "広告CL作成", assignees: ["SAI吉田", "SAI浜口"], start: "2026-09-01", end: "2026-09-15", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 68, projectId: 1, ankenId: 1, name: "広告LP作成", assignees: ["SAI吉田", "SAI浜口"], start: "2026-09-01", end: "2026-09-15", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 69, projectId: 1, ankenId: 1, name: "広告審査", assignees: ["SAI吉田", "SAI浜口"], start: "2026-09-16", end: "2026-09-30", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 70, projectId: 1, ankenId: 1, name: "広告開始", assignees: ["SAI吉田", "SAI浜口"], start: "2026-10-01", end: "2026-10-01", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 71, projectId: 1, ankenId: 1, name: "SEO集客準備", assignees: ["SAI吉田", "SAI浜口"], start: "2026-11-01", end: "2026-11-30", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 72, projectId: 1, ankenId: 1, name: "ポジティブ記事作成準備", assignees: ["SAI吉田", "SAI浜口"], start: "2026-12-01", end: "2026-12-25", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 73, projectId: 1, ankenId: 1, name: "ネガティブ記事削除準備", assignees: ["SAI吉田", "SAI浜口"], start: "2026-12-01", end: "2026-12-25", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 74, projectId: 1, ankenId: 1, name: "ポジティブ記事の量産開始", assignees: ["SAI吉田", "SAI浜口"], start: "2027-01-04", end: "2027-01-04", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 75, projectId: 1, ankenId: 1, name: "ネガティブ記事の削除開始", assignees: ["SAI吉田", "SAI浜口"], start: "2027-01-04", end: "2027-01-04", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 76, projectId: 1, ankenId: 1, name: "告知映像シナリオ作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 77, projectId: 1, ankenId: 1, name: "告知映像制作編集", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 78, projectId: 1, ankenId: 1, name: "CHヒアリング", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 79, projectId: 1, ankenId: 1, name: "プロモーションコンセプト設計", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 80, projectId: 1, ankenId: 1, name: "特典・保証企画作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 81, projectId: 1, ankenId: 1, name: "プロモーション導線構築/設計", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 82, projectId: 1, ankenId: 1, name: "動画シナリオ作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 83, projectId: 1, ankenId: 1, name: "FNシナリオ作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 84, projectId: 1, ankenId: 1, name: "プロモーション動画撮影", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 85, projectId: 1, ankenId: 1, name: "プロモーション動画編集", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 86, projectId: 1, ankenId: 1, name: "LINE返信テンプレ作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 87, projectId: 1, ankenId: 1, name: "配信スタンド/LINEアカウント構築", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 88, projectId: 1, ankenId: 1, name: "シナリオ設置/テスト", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 89, projectId: 1, ankenId: 1, name: "LP作成（デザイン〜設置）", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 90, projectId: 1, ankenId: 1, name: "FN作成（デザイン〜設置）", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 91, projectId: 1, ankenId: 1, name: "サンクスページ作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 92, projectId: 1, ankenId: 1, name: "SLページ作成作成", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 93, projectId: 1, ankenId: 1, name: "特商法準備", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 94, projectId: 1, ankenId: 1, name: "配信文の構築/設置", assignees: ["PP木村", "PP吉田"], start: "2026-06-15", end: "2026-06-30", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 95, projectId: 1, ankenId: 3, name: "プレプロモ最終調整", assignees: ["PP木村", "PP吉田"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 96, projectId: 1, ankenId: 3, name: "プレプロモ対応", assignees: ["PP木村", "PP吉田"], start: "2026-08-03", end: "2026-08-07", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 97, projectId: 1, ankenId: 3, name: "本リリースプロモ最終調整", assignees: ["PP木村", "PP吉田"], start: "2026-08-10", end: "2026-08-14", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 98, projectId: 1, ankenId: 3, name: "本リリースプロモ対応", assignees: ["PP木村", "PP吉田"], start: "2026-08-24", end: "2026-08-24", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 99, projectId: 1, ankenId: 3, name: "テキスト教材作成（ガイドブック）", assignees: ["MYH金子", "MYH奥山"], start: "2026-07-20", end: "2026-07-24", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 100, projectId: 1, ankenId: 1, name: "株トレ検定試験制作", assignees: ["MYH金子", "MYH奥山"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 101, projectId: 1, ankenId: 1, name: "株トレ検定試験実施", assignees: ["MYH金子", "MYH奥山"], start: "2026-07-31", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 102, projectId: 1, ankenId: 1, name: "LINEアカウントBAN対策設計", assignees: ["MYH金子", "MYH奥山"], start: "2026-06-29", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 103, projectId: 1, ankenId: 1, name: "メール配信リスク管理設計", assignees: ["MYH金子", "MYH奥山"], start: "2026-06-29", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 104, projectId: 1, ankenId: 1, name: "決済トラブル対応設計", assignees: ["MYH金子", "MYH奥山"], start: "2026-06-29", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 105, projectId: 1, ankenId: 1, name: "PJT月次レポート", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-03", end: "2026-08-05", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 106, projectId: 1, ankenId: 1, name: "PJT月次定例ファシリテート", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-03", end: "2026-08-05", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 107, projectId: 1, ankenId: 1, name: "記念イベント会場手配", assignees: ["MYH金子", "MYH吉田"], start: "2026-06-15", end: "2026-06-19", status: "in_progress", risk: "high", progressMemo: "", specialNotes: "", materials: "" },
  { id: 108, projectId: 1, ankenId: 1, name: "記念イベント運営準備", assignees: ["MYH金子", "MYH吉田"], start: "2026-07-01", end: "2026-08-22", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 109, projectId: 1, ankenId: 1, name: "記念イベント当日運営", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-23", end: "2026-08-23", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 110, projectId: 1, ankenId: 1, name: "リアルセミナー企画", assignees: ["MYH金子", "MYH吉田"], start: "2026-07-20", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 111, projectId: 1, ankenId: 1, name: "リアルセミナー会場手配", assignees: ["MYH金子", "MYH吉田"], start: "2026-07-20", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 112, projectId: 1, ankenId: 1, name: "リアルセミナー運営準備", assignees: ["MYH金子", "MYH吉田"], start: "2026-07-20", end: "2026-09-30", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 113, projectId: 1, ankenId: 1, name: "リアルセミナー当日運営", assignees: ["MYH金子", "MYH吉田"], start: "2026-09-01", end: "2026-09-30", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 114, projectId: 1, ankenId: 1, name: "CSサポートアサイン", assignees: ["MYH金子", "MYH吉田"], start: "2026-09-01", end: "2026-09-30", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 115, projectId: 1, ankenId: 3, name: "プレCS最終調整", assignees: ["MYH金子", "MYH吉田"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 116, projectId: 1, ankenId: 3, name: "プレCS対応", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-03", end: "2026-08-07", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 117, projectId: 1, ankenId: 3, name: "本リリースCS最終調整", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-10", end: "2026-08-14", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 118, projectId: 1, ankenId: 3, name: "本リリースCS対応", assignees: ["MYH金子", "MYH吉田"], start: "2026-08-31", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 119, projectId: 1, ankenId: 1, name: "法人準備", assignees: ["MYH豊川", "MYH山嵜"], start: "2026-06-15", end: "2026-06-26", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 120, projectId: 1, ankenId: 1, name: "会社電話番号準備", assignees: ["MYH豊川", "MYH山嵜"], start: "2026-06-29", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 121, projectId: 1, ankenId: 1, name: "銀行口座準備", assignees: ["MYH豊川", "MYH山嵜"], start: "2026-06-29", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 122, projectId: 1, ankenId: 1, name: "決済代行準備", assignees: ["MYH豊川", "MYH山嵜"], start: "2026-07-20", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 123, projectId: 1, ankenId: 1, name: "予算/資金繰り設計", assignees: ["MYH豊川", "MYH吉田"], start: "2026-06-29", end: "2026-06-30", status: "pending", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 124, projectId: 1, ankenId: 2, name: "クロージング戦略設計", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-06", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 125, projectId: 1, ankenId: 2, name: "クロージング導線構築", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-06", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 126, projectId: 1, ankenId: 2, name: "クロージング用電話番号取得", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-06", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 127, projectId: 1, ankenId: 2, name: "キックオフMTG設計", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-06", end: "2026-07-10", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 128, projectId: 1, ankenId: 2, name: "スクリプト&ロープレ実施", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-20", end: "2026-07-24", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 129, projectId: 1, ankenId: 3, name: "クロージング戦略設計", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-13", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 130, projectId: 1, ankenId: 3, name: "クロージング導線構築", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-13", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 131, projectId: 1, ankenId: 3, name: "クロージング用電話番号取得", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-13", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 132, projectId: 1, ankenId: 3, name: "キックオフMTG設計", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-13", end: "2026-07-17", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 133, projectId: 1, ankenId: 3, name: "スクリプト&ロープレ実施", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-20", end: "2026-07-24", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 134, projectId: 1, ankenId: 1, name: "営業代行管理シート作成", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 135, projectId: 1, ankenId: 1, name: "営業代行売上/KPI数値管理", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 136, projectId: 1, ankenId: 1, name: "GMOサイン/受講契約書作成/郵送", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 137, projectId: 1, ankenId: 1, name: "クローザーアサイン", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-01", end: "2026-07-03", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 138, projectId: 1, ankenId: 3, name: "プレクロージング最終調整", assignees: ["MYH豊川", "MYH吉田"], start: "2026-07-27", end: "2026-07-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 139, projectId: 1, ankenId: 3, name: "プレクロージング対応", assignees: ["MYH豊川", "MYH吉田"], start: "2026-08-03", end: "2026-08-07", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 140, projectId: 1, ankenId: 3, name: "本リリースクロージング最終調整", assignees: ["MYH豊川", "MYH吉田"], start: "2026-08-10", end: "2026-08-14", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 141, projectId: 1, ankenId: 3, name: "本リリースクロージング対応", assignees: ["MYH豊川", "MYH吉田"], start: "2026-08-31", end: "2026-08-31", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },

  // ── AI_kawai ──────────────────────────────────────────────
  // PHASE 1 – ヒアリング・リサーチ・コンセプト設計
  { id: 142, projectId: 2, ankenId: 4, name: "初回MTG",              assignees: ["共同"], start: "2026-05-01", end: "2026-05-01", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 143, projectId: 2, ankenId: 4, name: "3Cリサーチ",           assignees: ["柴田"], start: "2026-05-02", end: "2026-05-29", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 144, projectId: 2, ankenId: 4, name: "ヒアリングシート作成", assignees: ["柴田"], start: "2026-05-02", end: "2026-05-08", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 145, projectId: 2, ankenId: 4, name: "ホルダーヒアリング",   assignees: ["共同"], start: "2026-05-09", end: "2026-06-05", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 146, projectId: 2, ankenId: 4, name: "見込み客ヒアリング",   assignees: ["共同"], start: "2026-05-15", end: "2026-05-30", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 147, projectId: 2, ankenId: 4, name: "コンセプト設計・FV確定", assignees: ["柴田"], start: "2026-05-10", end: "2026-05-30", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 148, projectId: 2, ankenId: 4, name: "商品構成仮決め",       assignees: ["柴田"], start: "2026-05-10", end: "2026-06-10", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },

  // PHASE 2 – セミナー設計・チーム構築
  { id: 149, projectId: 2, ankenId: 5, name: "司会者選定・アテンド",   assignees: ["柴田"], start: "2026-05-14", end: "2026-05-31", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 150, projectId: 2, ankenId: 5, name: "クロージングチーム構築", assignees: ["柴田"], start: "2026-05-14", end: "2026-05-31", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 151, projectId: 2, ankenId: 5, name: "LINE返信チーム構築",    assignees: ["柴田"], start: "2026-05-14", end: "2026-05-31", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 152, projectId: 2, ankenId: 5, name: "バックオフィス体制構築", assignees: ["共同"], start: "2026-05-09", end: "2026-05-31", status: "completed", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },

  // PHASE 3 – クリエイティブ制作
  { id: 153, projectId: 2, ankenId: 6, name: "セールスレター(申込)ページ原稿",  assignees: ["柴田"], start: "2026-05-22", end: "2026-06-25", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 154, projectId: 2, ankenId: 6, name: "ステップLINE・メール原稿",        assignees: ["柴田"], start: "2026-05-22", end: "2026-06-25", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 155, projectId: 2, ankenId: 6, name: "特典制作",                        assignees: ["共同"], start: "2026-05-22", end: "2026-06-25", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 156, projectId: 2, ankenId: 6, name: "オプトLP原稿",                    assignees: ["柴田"], start: "2026-05-22", end: "2026-06-15", status: "completed",  risk: "normal",  progressMemo: "", specialNotes: "", materials: "" },
  { id: 157, projectId: 2, ankenId: 6, name: "セミナースライド骨格",            assignees: ["共同"], start: "2026-05-28", end: "2026-06-15", status: "completed",  risk: "normal",  progressMemo: "", specialNotes: "", materials: "" },
  { id: 158, projectId: 2, ankenId: 6, name: "LP・バナーデザイン",              assignees: ["広告"], start: "2026-06-08", end: "2026-06-27", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 159, projectId: 2, ankenId: 6, name: "セールスレター(申込ページ)デザイン", assignees: ["広告"], start: "2026-06-08", end: "2026-06-27", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 160, projectId: 2, ankenId: 6, name: "ステップLINE実装",                assignees: ["柴田"], start: "2026-06-12", end: "2026-06-28", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 161, projectId: 2, ankenId: 6, name: "セミナースライド仕上げ",          assignees: ["共同"], start: "2026-06-16", end: "2026-06-30", status: "in_progress", risk: "high",    progressMemo: "", specialNotes: "", materials: "" },
  { id: 162, projectId: 2, ankenId: 6, name: "サムネ・広告バナー",              assignees: ["広告"], start: "2026-06-10", end: "2026-06-27", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },

  // PHASE 4 – 入稿・テスト・スタート
  { id: 163, projectId: 2, ankenId: 7, name: "決済ページ作成",   assignees: ["広告"], start: "2026-06-15", end: "2026-06-25", status: "in_progress", risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 164, projectId: 2, ankenId: 7, name: "セミナーリハーサル", assignees: ["共同"], start: "2026-06-22", end: "2026-06-26", status: "pending",    risk: "high",    progressMemo: "", specialNotes: "", materials: "" },
  { id: 165, projectId: 2, ankenId: 7, name: "広告入稿・設定",   assignees: ["広告"], start: "2026-06-26", end: "2026-06-27", status: "pending",    risk: "high",    progressMemo: "", specialNotes: "", materials: "" },
  { id: 166, projectId: 2, ankenId: 7, name: "全体導線テスト",   assignees: ["共同"], start: "2026-06-23", end: "2026-06-28", status: "pending",    risk: "caution", progressMemo: "", specialNotes: "", materials: "" },
  { id: 167, projectId: 2, ankenId: 7, name: "広告スタート",     assignees: ["広告"], start: "2026-06-30", end: "2026-06-30", status: "pending",    risk: "high",    progressMemo: "", specialNotes: "", materials: "" },

  // 法人関連（空白→仮日付）
  { id: 168, projectId: 2, ankenId: 8, name: "法人準備",              assignees: ["森岡"], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 169, projectId: 2, ankenId: 8, name: "決済代行会社準備",      assignees: ["山口"], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 170, projectId: 2, ankenId: 8, name: "法人口座準備",          assignees: ["森岡"], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 171, projectId: 2, ankenId: 8, name: "サーバー準備(HP/LP準備)", assignees: ["山口"], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },

  // インフラ関連（空白→仮日付）
  { id: 172, projectId: 2, ankenId: 9, name: "配信スタンド準備",          assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 173, projectId: 2, ankenId: 9, name: "Lステップ＆LIGET",          assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 174, projectId: 2, ankenId: 9, name: "Xサーバー",                 assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 175, projectId: 2, ankenId: 9, name: "ペライチ(LP)",              assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 176, projectId: 2, ankenId: 9, name: "Googleアカウント",          assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },

  // 広告関連（空白→仮日付）
  { id: 177, projectId: 2, ankenId: 10, name: "広告インフラ準備",     assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 178, projectId: 2, ankenId: 10, name: "SEOインフラ準備",      assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 179, projectId: 2, ankenId: 10, name: "広告クリエイティブ作成", assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 180, projectId: 2, ankenId: 10, name: "広告審査",             assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
  { id: 181, projectId: 2, ankenId: 10, name: "収支管理インフラ準備",  assignees: [], start: "2026-06-16", end: "2026-06-16", status: "pending", risk: "normal", progressMemo: "", specialNotes: "", materials: "" },
];

const PERM_ROWS_RAW: PermRow[] = [
  { f: "プロジェクト / タスク閲覧",                 v: [{ t: "全PJ", c: "#0f6e56" }, { t: "担当PJ", c: "#6b7280" }, { t: "担当PJ", c: "#6b7280" }, { t: "担当PJ", c: "#6b7280" }] },
  { f: "タスク編集・削除",                          v: [{ t: "○ 全", c: "#1d9e75" }, { t: "○ 担当PJ全", c: "#1d9e75" }, { t: "△ 自分担当", c: "#ba7517" }, { t: "✕", c: "#c0392b" }] },
  { f: "タスク新規作成・複製",                      v: [{ t: "○ 全PJ", c: "#1d9e75" }, { t: "○ 担当PJ", c: "#1d9e75" }, { t: "△ 自分担当", c: "#ba7517" }, { t: "✕", c: "#c0392b" }] },
  { f: "設定（PJ・分類・メンバー・テンプレ）",   v: [{ t: "○", c: "#1d9e75" }, { t: "○", c: "#1d9e75" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }] },
  { f: "メンバーの招待",                              v: [{ t: "○ 全ロール", c: "#1d9e75" }, { t: "△ オペレーター以下", c: "#ba7517" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }] },
  { f: "管理者メンバーの編集",                      v: [{ t: "○", c: "#1d9e75" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }] },
  { f: "パスワード再設定（管理者操作）",            v: [{ t: "○", c: "#1d9e75" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }] },
  { f: "パスワードリセットメール送信",              v: [{ t: "○", c: "#1d9e75" }, { t: "○", c: "#1d9e75" }, { t: "✕", c: "#c0392b" }, { t: "✕", c: "#c0392b" }] },
];
const RAW_MEMBERS: SeedMember[] = [
  { name: "ALL奥山",  role: "管理者" },
  { name: "MYH吉田",  role: "メンバー" },
  { name: "MYH奥山",  role: "メンバー" },
  { name: "MYH山嵜",  role: "メンバー" },
  { name: "MYH豊川",  role: "メンバー" },
  { name: "MYH金子",  role: "メンバー" },
  { name: "PP吉田",   role: "メンバー" },
  { name: "PP木村",   role: "メンバー" },
  { name: "SAI吉田",  role: "メンバー" },
  { name: "SAI奥山",  role: "オペレーター" },
  { name: "SAI山嵜",  role: "メンバー" },
  { name: "SAI柴垣",  role: "メンバー" },
  { name: "SAI浜口",  role: "メンバー" },
  { name: "SAI野々山", role: "メンバー" },
  { name: "SAI阿部",  role: "メンバー" },
  { name: "共同",     role: "外部" },
  { name: "柴田",     role: "オペレーター" },
  { name: "広告",     role: "外部" },
  { name: "森岡",     role: "メンバー" },
  { name: "山口",     role: "メンバー" },
];

const RAW_TEMPLATES: SeedTemplateRaw[] = [
  {
    id: 1,
    name: "LP制作標準",
    anken: [
      {
        name: "企画",
        tasks: [
          { name: "ヒアリング",       startOffset: 0,  endOffset: 7  },
          { name: "競合調査",         startOffset: 3,  endOffset: 14 },
          { name: "コンセプト設計",   startOffset: 10, endOffset: 21 },
        ],
      },
      {
        name: "制作",
        tasks: [
          { name: "LP原稿作成",   startOffset: 14, endOffset: 28 },
          { name: "デザイン",     startOffset: 21, endOffset: 42 },
          { name: "コーディング", startOffset: 35, endOffset: 49 },
        ],
      },
      {
        name: "確認・入稿",
        tasks: [
          { name: "クライアント確認", startOffset: 42, endOffset: 49 },
          { name: "修正対応",         startOffset: 49, endOffset: 56 },
          { name: "入稿",             startOffset: 56, endOffset: 60 },
        ],
      },
    ],
  },
];


// ── ビルダー（欠落フィールドを既定値で補完してドメイン型化） ──
const mkProject = (p: SeedProject): Project => ({
  abbreviation: "", closeDate: "", notifyChat: "",
  checkpoint1Name: "", checkpoint1Date: "", checkpoint2Name: "", checkpoint2Date: "",
  checkpoint3Name: "", checkpoint3Date: "",
  notifyOverrides: {}, isDeleted: false, ...p,
});
const mkAnken = (a: SeedAnken): Anken => ({
  abbreviation: "", leaderId: null, isDeleted: false, ...a,
});
const mkTask = (t: SeedTask): Task => ({
  assigneeIds: [], completedAt: null, importance: "none", updatedAt: null, updatedBy: "", ...t,
});
const mkMember = (m: SeedMember, i: number): Member => ({
  id: -(i + 1), userId: null, email: "", company: "", chatId: "", isDeleted: false, ...m,
});
const mkTemplate = (t: SeedTemplateRaw): Template => ({
  id: t.id,
  name: t.name,
  anken: t.anken.map((a) => ({
    name: a.name,
    tasks: a.tasks.map((tk) => ({
      name: tk.name,
      startOffset: tk.startOffset,
      endOffset: tk.endOffset,
      importance: "none" as const,
      progressMemo: "", specialNotes: "", materials: "",
    })),
  })),
});

export const PERM_ROWS: PermRow[] = PERM_ROWS_RAW;
export const INITIAL_PROJECTS: Project[] = RAW_PROJECTS.map(mkProject);
export const INITIAL_ANKEN: Anken[] = RAW_ANKEN.map(mkAnken);
export const INITIAL_TASKS: Task[] = RAW_TASKS.map(mkTask);
export const INITIAL_MEMBERS: Member[] = RAW_MEMBERS.map(mkMember);
export const INITIAL_TEMPLATES: Template[] = RAW_TEMPLATES.map(mkTemplate);
