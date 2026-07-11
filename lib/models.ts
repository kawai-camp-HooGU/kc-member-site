// ============================================================
// アプリ内ドメイン型（camelCase）
// lib/supabase.ts の変換ヘルパー（toProject 等）の戻り値と一致させる。
// ============================================================
import type { RiskLevel, TaskStatus, MemberRole } from "./database.types";

export type Risk = RiskLevel;
export type Status = TaskStatus;
export type Role = MemberRole;

/** 重要度: 1=Ⅰ / 2=Ⅱ / 3=Ⅲ / "none"=なし（DBのNULLに対応） */
export type Importance = 1 | 2 | 3 | "none";

/** 権限（内部ロール）: members.role（日本語）から解決 */
export type PermissionRole = "admin" | "leader" | "member" | "external";

export interface Project {
  id: number;
  name: string;
  abbreviation: string;
  startDate: string;
  dueDate: string;
  closeDate: string;
  notifyChat: string;
  checkpoint1Name: string;
  checkpoint1Date: string;
  checkpoint2Name: string;
  checkpoint2Date: string;
  checkpoint3Name: string;
  checkpoint3Date: string;
  progress: number;
  risk: Risk;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  memberNames: string[];
  notifyOverrides: Record<string, unknown>;
  isDeleted: boolean;
}

export interface Anken {
  id: number;
  projectId: number;
  name: string;
  abbreviation: string;
  leaderId: number | null;
  leader: string;
  progress: number;
  risk: Risk;
  dueDate: string;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  isDeleted: boolean;
}

export interface Task {
  id: number;
  projectId: number;
  ankenId: number;
  name: string;
  assigneeIds: number[];
  assignees: string[];
  start: string;
  end: string;
  status: Status;
  risk: Risk;
  progressMemo: string;
  specialNotes: string;
  materials: string;
  completedAt: string | null;
  importance: Importance;
  updatedAt: string | null;
  updatedBy: string;
}

export interface MemberMemo {
  id?: number;
  title: string;
  body: string;
  updatedAt: string;
}

export interface Member {
  id: number;
  name: string;
  role: Role;
  userId: string | null;
  email: string;
  company: string;
  chatId: string;
  isDeleted: boolean;
  // ── メンバーマスタ拡張（任意。未取得時は既定値）──
  kana?: string;
  tel?: string;
  prefecture?: string;
  createdAt?: string;
  /** 流入経路（招待時に付与） */
  source?: string;
  /** 付与された属性の末端ノードID配列（属性マスタ attributes.id） */
  attrIds?: number[];
  memos?: MemberMemo[];
  // ── 通知（Web Push）の状態 ──
  /** 通知を受け取れる登録端末の台数（0=未登録） */
  pushDevices?: number;
  /** 登録端末の内訳（一覧・詳細表示用） */
  pushDeviceInfo?: { userAgent: string; createdAt: string }[];
  /** 通知設定（未設定は既定ON） */
  notifyEnabled?: boolean;
  notifyChatEnabled?: boolean;
  notifyNewsEnabled?: boolean;
  // ── 利用状況 ──
  /** ログイン記録（未ログインは空） */
  firstLoginAt?: string;
  lastLoginAt?: string;
  loginCount?: number;
}

export interface TemplateTask {
  name: string;
  startOffset: number | "";
  endOffset: number | "";
  importance: Importance;
  progressMemo: string;
  specialNotes: string;
  materials: string;
}

export interface TemplateAnken {
  name: string;
  tasks: TemplateTask[];
}

export interface Template {
  id: number | null;
  name: string;
  anken: TemplateAnken[];
}

/** id をキーにした member 参照マップ（表示名解決に使用） */
export type MemberById = Record<number, Member>;

// ── 新機能: コンテンツ ───────────────────────────────────────
export type ContentGenre = "video" | "file" | "link";

export interface ContentItem {
  id: number;
  genre: ContentGenre;
  title: string;
  meta: string;
  date?: string;
  badge?: string;
  ext?: string;
  url?: string;
  licon?: string;
  /** 公開対象: "all"=全員 / string[]=メンバー名の配列 */
  target: "all" | string[];
  published: boolean;
}

// ── コンテンツ機能（ページ／コンテンツ マスタ）──
/** 公開条件（属性ABCの含み方）。メンバー抽出条件と同じ4種。 */
export type PublishMode = "any" | "all" | "exany" | "exall";
/** コンテンツ種別：動画(URL埋め込み) / 資料(URL埋め込み) / なし(テキスト・HTML) */
export type ContentKind = "video" | "doc" | "none";
export type NoneMode = "text" | "html";

export interface ContentPage {
  id: number;
  name: string;
  abbr: string;
  createdAt: string;
  sortOrder: number;
  attrMode: PublishMode;
  attrIds: number[];   // 公開対象属性（末端ノードID）
}

// ── お知らせ ──
export type NewsCategory = "notice" | "maint" | "event";
export interface NewsItem {
  id: number;
  category: NewsCategory;
  title: string;
  bodyMode: NoneMode;   // "text" | "html"
  bodyText: string;
  bodyHtml: string;
  important: boolean;
  published: boolean;
  publishedAt: string;  // datetime-local 文字列（"YYYY-MM-DDTHH:mm"）
  attrMode: PublishMode;
  attrIds: number[];
  sortOrder: number;
}

export interface CmsContent {
  id: number;
  pageId: number;
  name: string;
  createdAt: string;
  sortOrder: number;
  published: boolean;
  kind: ContentKind;
  url: string;          // 動画/資料の埋め込みURL
  noneMode: NoneMode;
  bodyText: string;
  bodyHtml: string;
  thumbUrl: string;     // サムネイル画像URL（任意）
  attrMode: PublishMode;
  attrIds: number[];    // 公開対象属性（末端ノードID）
}

/** fetchAllData の戻り値 */
export interface AppData {
  projects: Project[];
  anken: Anken[];
  tasks: Task[];
  members: Member[];
  templates: Template[];
}

/** MultiSelect 等の選択肢 */
export interface SelectOption {
  value: string;
  label: string;
}

// ── チャット ─────────────────────────────────────────────────
/** メッセージの向き: member=顧客発 / staff=社内スタッフ発 */
export type ChatSide = "member" | "staff";

export interface ChatAttachment {
  id: number;
  messageId: number;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
}

/** スタッフ一覧の1行（会話＋顧客＋未読数） */
export interface ChatThread {
  conversationId: number;
  member: Member;
  assignedTo: number | null;
  lastMessageAt: string;
  lastSnip: string;
  staffLastReadAt: string | null;
  unread: number;
}

/** 流入経路ごとのウェルカム文面 */
export interface WelcomeRoute {
  key: string;      // 経路キー（招待リンクに付与する識別子）
  label: string;    // 表示名
  message: string;  // 送信文面
}

/** 全般設定（機能ON/OFFフラグ・アプリ全体） */
export interface AppSettings {
  chatworkEnabled: boolean;
  bulkRegisterEnabled: boolean;
  contentEnabled: boolean;
  // ── 初回ログイン時のウェルカムメッセージ ──
  welcomeEnabled: boolean;
  welcomeDefault: string;        // 既定文面（経路未指定・未一致時）
  welcomeRoutes: WelcomeRoute[]; // 経路別文面
}
export const DEFAULT_APP_SETTINGS: AppSettings = {
  chatworkEnabled: true,
  bulkRegisterEnabled: true,
  contentEnabled: true,
  welcomeEnabled: false,
  welcomeDefault: "",
  welcomeRoutes: [],
};

// ── 一斉配信（ブロードキャスト）─────────────────────────────
export type BroadcastStatus = "draft" | "scheduled" | "sent";
export interface Broadcast {
  id: number;
  title: string;
  status: BroadcastStatus;
  targetMode: "all" | "filter";   // 全員 / 条件で絞り込み
  targetAttrIds: number[];        // 属性ABC（いずれか含む）
  targetSource: string;           // 流入経路キー（""=指定なし）
  channelChat: boolean;           // アプリ内チャットへ配信
  channelEmail: boolean;          // メールへ配信
  scheduledAt: string;            // 予約日時（""=今すぐ）
  messageBody: string;            // 本文（変数・URL可）
  recipientCount: number;         // 配信数（送信時に確定）
  sentAt: string;                 // 送信完了日時
  createdAt: string;
}

// ── シナリオ配信（ステップ配信）─────────────────────────────
export type ScenarioTrigger = "source" | "login" | "attribute" | "manual";
export type StepDelayUnit = "immediate" | "hours" | "days";
export interface ScenarioStep {
  id: number;
  sortOrder: number;
  delayUnit: StepDelayUnit;
  delayValue: number;       // hours/days のときの値
  timeOfDay: string;        // "HH:MM"（days時のみ・""=指定なし）
  channelChat: boolean;
  channelEmail: boolean;
  messageBody: string;
}
export interface Scenario {
  id: number;
  name: string;
  active: boolean;
  triggerType: ScenarioTrigger;
  targetSource: string;     // 流入経路キー（""=指定なし）
  targetAttrIds: number[];  // 属性ABC（いずれか含む）
  steps: ScenarioStep[];
  createdAt: string;
}
export const SCENARIO_TRIGGER_LABEL: Record<ScenarioTrigger, string> = {
  source:    "流入経路の付与時",
  login:     "初回ログイン時",
  attribute: "属性の付与時",
  manual:    "手動で追加",
};

/** 差し込み変数（本文で顧客情報を出力） */
export interface BroadcastVariable { token: string; label: string; }
export const BROADCAST_VARIABLES: BroadcastVariable[] = [
  { token: "{{氏名}}",     label: "氏名" },
  { token: "{{セイ}}",     label: "セイ" },
  { token: "{{所属}}",     label: "所属" },
  { token: "{{流入経路}}", label: "流入経路" },
  { token: "{{都道府県}}", label: "都道府県" },
  { token: "{{メール}}",   label: "メール" },
];
