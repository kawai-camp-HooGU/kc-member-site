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
  /** @deprecated Phase 3：旧・流入経路キー（自由テキスト）。表示・判定には sourceId を使うこと。 */
  source?: string;
  /** Phase 3：初回流入（sources.id）。招待・フォーム・?src= で付与。 */
  sourceId?: number | null;
  /** Phase 3：最新流入（sources.id） */
  lastSourceId?: number | null;
  /** Phase 3：初回流入日時 */
  sourceAt?: string;
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

// ── 流入経路（Phase 3：マスタとして独立）────────────────────
export type SourceCategory = "ad" | "seminar" | "referral" | "sns" | "organic" | "offline" | "other";

export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  ad:       "広告",
  seminar:  "セミナー",
  referral: "紹介",
  sns:      "SNS",
  organic:  "自然流入",
  offline:  "オフライン",
  other:    "その他",
};

export const SOURCE_CATEGORIES: SourceCategory[] =
  ["ad", "seminar", "referral", "sns", "organic", "offline", "other"];

/** 流入経路マスタ（sources テーブル） */
export interface Source {
  id: number;
  /** URL の ?src= に載せる識別子。配布済み QR/URL が死ぬため原則不変。 */
  key: string;
  label: string;
  category: SourceCategory;
  /** 誘導先（例: /f/entry）。未指定なら /login */
  landingPath: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  color: string;
  memo: string;
  /** 停止しても既存会員の紐付けは残る（新規付与だけ止まる） */
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export const DEFAULT_SOURCE_COLOR = "#6b6b73";

/** 経路ごとのウェルカム文面（welcome_messages テーブル） */
export interface WelcomeMessage {
  sourceId: number;
  message: string;
}

/**
 * @deprecated Phase 3：旧・app_settings.welcome_routes(JSON) の要素。
 *   経路の定義は sources、文面は welcome_messages に分離した。
 *   ロールバック用に型だけ残置している。
 */
export interface WelcomeRoute {
  key: string;
  label: string;
  message: string;
}

/** 全般設定（機能ON/OFFフラグ・アプリ全体） */
export interface AppSettings {
  chatworkEnabled: boolean;
  bulkRegisterEnabled: boolean;
  contentEnabled: boolean;
  // ── 初回ログイン時のウェルカムメッセージ ──
  welcomeEnabled: boolean;
  welcomeDefault: string;        // 既定文面（経路未指定・未一致時）
  /** @deprecated Phase 3：経路別文面は welcome_messages テーブルへ移行済み。 */
  welcomeRoutes: WelcomeRoute[];
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
  /** @deprecated Phase 3：旧・単一経路キー。targetSourceIds を使うこと。 */
  targetSource: string;
  /** Phase 3：流入経路（sources.id。空=指定なし。複数指定はOR） */
  targetSourceIds: number[];
  /** Phase 3：カテゴリ一括指定（例: ["ad"] で広告経由の全員。空=指定なし） */
  targetSourceCats: SourceCategory[];
  channelChat: boolean;           // アプリ内チャットへ配信
  channelEmail: boolean;          // メールへ配信
  scheduledAt: string;            // 予約日時（""=今すぐ）
  messageBody: string;            // 本文（変数・URL可）
  recipientCount: number;         // 配信数（送信時に確定）
  sentAt: string;                 // 送信完了日時
  createdAt: string;
  /** AI(⑤)で原稿を生成したか（監査用・任意） */
  aiAssisted?: boolean;
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
  /** @deprecated Phase 3：旧・単一経路キー。targetSourceIds を使うこと。 */
  targetSource: string;
  /** Phase 3：流入経路（sources.id。空=指定なし） */
  targetSourceIds: number[];
  /** Phase 3：カテゴリ一括指定（空=指定なし） */
  targetSourceCats: SourceCategory[];
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

// ── フォーム（Lステップ「回答フォーム」相当）───────────────────
/** 設問ブロックの種類 */
export type FieldType =
  | "text" | "textarea" | "radio" | "checkbox" | "select"
  | "date" | "file" | "pref" | "number" | "heading";
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text:     "記述式（テキストボックス）",
  textarea: "段落（テキストエリア）",
  radio:    "ラジオボタン",
  checkbox: "チェックボックス",
  select:   "プルダウン",
  date:     "日付",
  file:     "ファイル添付",
  pref:     "都道府県",
  number:   "数値",
  heading:  "見出し／説明文",
};
/** 選択肢を持つ種類 */
export const HAS_OPTIONS: FieldType[] = ["radio", "checkbox", "select"];
/** 回答値を持たない（表示専用）種類 */
export const IS_DISPLAY_ONLY = (t: FieldType) => t === "heading";

/** 入力規則 */
export type FieldRule = "email" | "tel" | "zip" | "numeric" | "kana";
export const FIELD_RULE_LABEL: Record<FieldRule, string> = {
  email:   "メールアドレス",
  tel:     "電話番号",
  zip:     "郵便番号",
  numeric: "半角数字",
  kana:    "ひらがな",
};

/** 回答の登録先（会員マスタのカラム） */
export type SaveTarget = "name" | "kana" | "email" | "tel" | "prefecture" | "company";
export const SAVE_TARGET_LABEL: Record<SaveTarget, string> = {
  name: "氏名", kana: "セイ", email: "メールアドレス", tel: "電話番号",
  prefecture: "都道府県", company: "所属",
};

/** アクション（選択時 / 回答後で共通） */
export type FormActionType =
  | "attr_add" | "attr_remove" | "scenario_start" | "scenario_stop" | "chat_message";
export interface FormAction {
  type: FormActionType;
  attrId?: number;        // attr_add / attr_remove
  scenarioId?: number;    // scenario_start / scenario_stop
  body?: string;          // chat_message
}
export const FORM_ACTION_LABEL: Record<FormActionType, string> = {
  attr_add:       "属性を付与",
  attr_remove:    "属性を解除",
  scenario_start: "シナリオを開始",
  scenario_stop:  "シナリオを停止",
  chat_message:   "チャットにメッセージ送信",
};

/** 表示条件（分岐）：指定設問の回答が値と一致/不一致のときだけ表示 */
export interface FieldCondition {
  fieldId: number;
  op: "eq" | "neq";
  value: string;
}

export interface FormOption { label: string; actions: FormAction[]; }

export interface FormField {
  id: number;
  type: FieldType;
  label: string;
  description: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
  rule: FieldRule | "";
  minLen: number | "";
  maxLen: number | "";
  maxSelect: number | "";
  saveTo: SaveTarget | "";
  options: FormOption[];
  condition: FieldCondition | null;
  sortOrder: number;
}

export interface FormSection {
  id: number;
  name: string;
  condition: FieldCondition | null;
  sortOrder: number;
  fields: FormField[];
}

export type FormStatus = "draft" | "published" | "closed";
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  draft: "下書き", published: "公開中", closed: "受付終了",
};
export type FormVisibility = "member" | "both";
export const FORM_VISIBILITY_LABEL: Record<FormVisibility, string> = {
  member: "会員のみ", both: "会員＋外部",
};

export interface FormDesign {
  color: string;         // メインカラー
  bgColor: string;       // 背景色
  headerImage: string;   // ヘッダー画像URL
  submitLabel: string;   // 送信ボタン文言
  progress: boolean;     // プログレスバー
  customCss: string;
}
export const DEFAULT_FORM_DESIGN: FormDesign = {
  color: "#dc2626", bgColor: "#f7f7f8", headerImage: "",
  submitLabel: "送信する", progress: true, customCss: "",
};

export interface FormDef {
  id: number;
  name: string;
  folder: string;
  slug: string;
  title: string;
  description: string;
  status: FormStatus;
  visibility: FormVisibility;
  deadlineAt: string;        // "" = 期限なし（"YYYY-MM-DDTHH:mm"）
  deadlineMessage: string;
  answerLimit: number;       // 0 = 無制限
  confirmDialog: boolean;
  confirmText: string;
  thanksUrl: string;
  thanksText: string;
  design: FormDesign;
  afterActions: FormAction[];
  autofillMember: boolean;
  notifyEnabled: boolean;
  sections: FormSection[];
  createdAt: string;
  updatedAt: string;
}

/** 回答（1送信＝1レコード） */
export type SubmissionStatus = "new" | "doing" | "done";
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  new: "未対応", doing: "対応中", done: "完了",
};
export interface FormAnswer {
  fieldId: number | null;
  label: string;
  value: string;
  valueList: string[];
  filePath: string;
}
/** 送信チャネル（どの導線から回答されたか）。※ 流入経路（Source）とは別物。 */
export type FormChannel = "direct" | "chat" | "broadcast" | "scenario" | "qr";

export interface FormSubmission {
  id: number;
  formId: number;
  memberId: number | null;
  guestName: string;
  guestEmail: string;
  status: SubmissionStatus;
  assigneeId: number | null;
  /**
   * Phase 3：送信チャネル（旧 `source`）。
   *   ⚠️ 用語衝突の解消：members の「流入経路」とは意味が違う。
   *      こちらは「どの導線でフォームに来たか」。
   */
  channel: FormChannel | string;
  /** Phase 3：流入経路（sources.id）。?src= から解決。 */
  sourceId: number | null;
  submittedAt: string;
  answers: FormAnswer[];
}
