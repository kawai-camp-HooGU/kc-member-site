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

// ── 決済情報（payments）──────────────────────────────────────
//   外部決済サイトで確認した決済を運営が登録し、memberId で会員に紐付ける。
//   金額は「円＝整数」で保持（当面 JPY 固定。表示は toLocaleString）。
export interface Payment {
  id: number;
  /** 照合先の会員（members.id）。未照合は null。 */
  memberId: number | null;
  /** 入力時点の顧客名（照合前表示・手がかり） */
  customerName: string;
  /** 氏名カナ（決済時点の入力値。会員マスタへは反映しない） */
  customerKana: string;
  /** 自動照合の第一キー */
  customerEmail: string;
  /** 電話番号（決済時点の入力値。会員マスタへは反映しない） */
  customerTel: string;
  /** 決済完了日時（"YYYY-MM-DDTHH:mm"。未入力は ""） */
  paidAt: string;
  /** 商品種別マスタ(payment_product_types.id)。表示は番号→マスタ参照。 */
  typeId: number | null;
  /** 決済サイトマスタ(payment_sites.id) */
  siteId: number | null;
  /** 決済方法マスタ(payment_methods.id) */
  methodId: number | null;
  /** 決済金額（円＝整数） */
  amount: number;
  /** 売上計上金額（円）。空/0 の登録時は amount を自動セット。 */
  recognizedAmount: number;
  currency: string;   // "JPY"
  note: string;
  status: "matched" | "unmatched";
  /** payment-shots 上のパス（スクショ。未保存は null） */
  screenshotPath: string | null;
  createdAt: string;
}

/** 決済マスタ（商品種別 / 決済サイト / 決済方法）の共通型 */
export interface PaymentMaster {
  id: number;
  name: string;
  note: string;
  sortOrder: number;
  isDeleted: boolean;
  /** 商品種別のみ：売上計上フラグ */
  salesFlag?: boolean;
  /** 商品種別のみ：決済必要金額（円） */
  requiredAmount?: number;
}

/** AI がスクショから読み取った決済情報の下書き（各項目は任意。マスタは名称で返す） */
export interface PaymentExtract {
  paidAt?: string;
  /** 商品種別・サイト・方法は「名称」で返す（アプリ側でマスタIDへ突合） */
  typeName?: string;
  siteName?: string;
  methodName?: string;
  amount?: number;
  /** 売上計上金額（決済金額から手数料を差し引いた対象金額。読めれば返す） */
  recognizedAmount?: number;
  currency?: string;
  customerName?: string;
  customerKana?: string;
  customerEmail?: string;
  customerTel?: string;
  /** 確信度が低く「要確認」にしたい項目名（例: ["customerName"]） */
  lowConfidence?: string[];
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

/** 公開ページ /p のレイアウト。cards＝カード一覧（既定）／embed＝1カラムで動画・資料・本文をインライン埋め込み */
export type PageLayout = "cards" | "embed";
export const PAGE_LAYOUT_LABEL: Record<PageLayout, string> = { cards: "カード一覧", embed: "埋め込み表示（1カラム）" };

export interface ContentPage {
  id: number;
  name: string;
  abbr: string;
  overview: string;    // 概要（会員のタブ下に表示。任意）
  /** 公開ページ /p の表示方式。既定は cards（既存挙動）。embed で動画等をインライン埋め込み */
  layout: PageLayout;
  createdAt: string;
  sortOrder: number;
  attrMode: PublishMode;
  attrIds: number[];   // 公開対象属性（末端ノードID）
  /** 公開URLトークン。新規登録時にDBが自動発行し、以後変更不可（/p/{publicToken}）。未保存は "" */
  publicToken: string;
  /** 外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。publishedがOFFなら無効 */
  isExternal: boolean;
  /** 公開トグル。OFFなら /p/{token} は404 */
  published: boolean;
}

// ── イベント・予定（カレンダー掲載）──
/** 予定の種別（色の既定値と一覧の見出しに使う） */
export type EventKind = "event" | "meeting" | "deadline" | "other";
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  event: "イベント／行事", meeting: "説明会・ミーティング", deadline: "締切", other: "休業・その他",
};
// ⚠️ 青（#2563eb）はフォーム締切チップ専用に予約している。
//    イベントに青を使うと、カレンダー上でフォーム締切と見分けがつかなくなるため使わない。
//    「説明会・ミーティング」はシアン（#0891b2）にして青との衝突を避ける。
export const EVENT_KIND_COLOR: Record<EventKind, string> = {
  event: "#0d9488", meeting: "#0891b2", deadline: "#7c3aed", other: "#ea580c",
};

/**
 * コミュニティのイベント／予定。
 *   ・公開対象は属性ABC＋公開条件（コンテンツ／お知らせと同じ canView で判定）
 *   ・出欠は持たない。申込・アンケートは formId に紐付けたフォームで受ける
 */
export interface CalEvent {
  id: number;
  title: string;
  kind: EventKind;
  color: string;
  allDay: boolean;
  startAt: string;        // datetime-local 文字列（"YYYY-MM-DDTHH:mm"）
  endAt: string;
  location: string;
  url: string;
  bodyText: string;
  published: boolean;
  newsId: number | null;  // お知らせ連携（お知らせから作られた予定）
  formId: number | null;  // 申込・回答フォーム
  showFormDeadline: boolean;
  attrMode: PublishMode;
  attrIds: number[];
  createdAt: string;
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
  /** 公開URLトークン。新規登録時にDBが自動発行し、以後変更不可（/c/{publicToken}）。未保存は "" */
  publicToken: string;
  sortOrder: number;
  published: boolean;
  /** 外部公開。ON＝公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。published が OFF なら無効。 */
  isExternal: boolean;
  kind: ContentKind;
  url: string;          // 動画/資料の埋め込みURL
  noneMode: NoneMode;
  bodyText: string;
  bodyHtml: string;
  thumbUrl: string;     // サムネイル画像URL（任意）
  attrMode: PublishMode;
  attrIds: number[];    // 公開対象属性（末端ノードID）

  /**
   * アップロードした資料（PDF等）。Storage(content-files) のパス。
   *   URL 埋め込み（url）との違い：
   *     url       … 外部（Googleドライブ等）に実体がある。共有設定に依存し、URLが漏れれば誰でも取れる。
   *     filePath  … 実体をプライベートバケットに持つ。閲覧可否をサーバーで判定してから
   *                 期限付きの署名URLを発行するため、会員限定が成立する。
   *   両方セットされている場合は filePath を優先して表示する。
   */
  filePath: string;
  fileName: string;     // ダウンロード時の保存名
  fileSize: number;     // バイト数（0＝不明）
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

/**
 * メッセージの送信元。
 *   side（member/staff）だけでは「人が書いた返信」と「自動配信」を区別できないため追加した。
 *   ⚠️ 運営画面では出し分ける（人＝塗り／自動＝白地＋タグ）が、
 *      会員画面では一切ラベルを出さない（内部の仕組みを見せない）。
 */
export type ChatOrigin = "member" | "staff" | "broadcast" | "scenario" | "action";

export const CHAT_ORIGIN_LABEL: Record<ChatOrigin, string> = {
  member: "会員",
  staff: "運営",
  broadcast: "一斉配信",
  scenario: "シナリオ配信",
  action: "自動アクション",
};

/** 本文中のURL（訪問計測つき） */
export interface ChatLink {
  id: number;
  messageId: number;
  url: string;
  /** 未訪問なら "" */
  clickedAt: string;
  lastClickAt: string;
  clickCount: number;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
  origin: ChatOrigin;
  /** 引用返信の元メッセージID（null＝通常メッセージ） */
  replyToId: number | null;
  /** 本文から抽出したURL。運営画面で訪問状況を出す */
  links: ChatLink[];
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
  /**
   * この経路が会員に紐づいた時に実行するアクション（属性付与・シナリオ・チャット送信）。
   *   発火点：① 公開URL /s/{key} をログイン中の会員が踏んだ
   *           ② ?src= 付きでフォームに回答した（新規登録・既存会員とも）
   */
  actions: FormAction[];
  /** true=1人1経路につき1回だけ発火／false=踏むたびに発火 */
  fireOnce: boolean;
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
  | "attr_add" | "attr_remove" | "scenario_start" | "scenario_stop" | "chat_message"
  /** 回答者を「外部」ロールの会員として登録し、招待メール（パスワード設定）を送る */
  | "member_signup";
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
  member_signup:  "会員登録（外部ロール）",
};

/** 表示条件（分岐）：指定設問の回答が値と一致/不一致のときだけ表示 */
export interface FieldCondition {
  fieldId: number;
  op: "eq" | "neq";
  value: string;
}

/**
 * 表示条件のグループ（分岐）。セクション・設問の condition に入れる。
 *   conditions が空なら常に表示。複数あるときは match で AND/OR を切り替える。
 *   ⚠️ 旧データは condition が単体 FieldCondition だった。読込時に formParse の
 *      toCondGroup が1件のグループへ畳んで吸収する（旧形式は書き戻さない）。
 *   ⚠️ CondMatch はこのファイルの下部（自動返信ブロック）で定義済みのものを共用する。
 */
export interface CondGroup {
  match: CondMatch;
  conditions: FieldCondition[];
}
/** 空の条件グループ（＝常に表示）。newField/newSection の初期値。 */
export const EMPTY_COND_GROUP: CondGroup = { match: "all", conditions: [] };

export interface FormOption { label: string; actions: FormAction[]; }

export interface FormField {
  id: number;
  type: FieldType;
  label: string;
  description: string;
  /** 説明文を HTML として表示するか（true=サニタイズHTML／false=テキスト・改行保持） */
  descHtml: boolean;
  placeholder: string;
  defaultValue: string;
  required: boolean;
  rule: FieldRule | "";
  minLen: number | "";
  maxLen: number | "";
  maxSelect: number | "";
  saveTo: SaveTarget | "";
  options: FormOption[];
  /** ラジオ／チェックの選択肢を「価格カード」で見せる（名称と ｜ 以降を分けて大きく表示）。既定 false=リスト。 */
  optionCards: boolean;
  condition: CondGroup;
  sortOrder: number;
}

export interface FormSection {
  id: number;
  name: string;
  condition: CondGroup;
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

/**
 * 未ログイン回答者（会員＋外部フォーム）に出す「ご連絡先」欄の設定。
 *   見出し・説明・各ラベル・必須の有無をフォームごとに変えられる。
 *   ⚠️ design(jsonb) の中に入れて保存する（専用列は作らない）。
 */
export interface GuestContact {
  title: string;         // 見出し（例：ご連絡先）
  note: string;          // 説明文
  nameLabel: string;     // お名前の欄のラベル（「氏名」等に変更可）
  nameRequired: boolean;
  emailLabel: string;    // メールアドレスの欄のラベル
  emailRequired: boolean;
  /**
   * 氏名・メールの取得元。
   *   "auto"   … 登録先＝氏名／メールの設問があればそれを使い、この欄には出さない（重複入力の解消）
   *   "always" … 設問の有無に関わらず、確認用として必ずこの欄を出す（旧来の挙動）
   * ⚠️ サーバー側（formsServer の pickEmail/pickName）は元々「設問 → ゲスト欄」の順で
   *    拾っており、"auto" はその挙動を回答画面のUIにも一致させるもの。
   */
  mode: "auto" | "always";
}
export const DEFAULT_GUEST_CONTACT: GuestContact = {
  title: "ご連絡先",
  note: "ご回答の確認・ご連絡に使用します。",
  nameLabel: "お名前・ニックネーム",
  nameRequired: true,
  emailLabel: "メールアドレス",
  emailRequired: true,
  mode: "auto",
};

/**
 * 回答後に表示する画面の種類。
 *   text … 改行を保持したプレーンテキスト（thanksText）
 *   html … サニタイズ済みHTML（design.thanksHtml）
 *   url  … 指定URLへ遷移（thanksUrl）
 * ⚠️ 旧データには無い。読込時に thanks_url の有無から補完する（formParse の toDesign）。
 */
export type ThanksMode = "text" | "html" | "url";

/**
 * 自動返信メールの本文ブロック。
 *   conditions が空なら常に出力し、条件つきなら満たしたときだけ出力する。
 *   条件の型は設問の分岐（FieldCondition）と同じものを使い回している。
 *
 * ⚠️ 旧データは条件を単体（condition: FieldCondition | null）で持っている。
 *    読込時に formParse の toDesign が conditions[] へ畳んで吸収するので、
 *    アプリ内部はこの配列だけを見ればよい（旧形式は書き戻さない）。
 */
export interface AutoReplyBlock {
  conditions: FieldCondition[];
  /** all＝すべて満たしたとき（AND）／any＝どれか1つ満たしたとき（OR） */
  condMatch: CondMatch;
  body: string;
}
export type CondMatch = "all" | "any";
export const COND_MATCH_LABEL: Record<CondMatch, string> = {
  all: "すべて満たすとき",
  any: "どれか1つを満たすとき",
};

/** 回答者本人への自動返信メール設定 */
export interface AutoReply {
  enabled: boolean;
  fromName: string;      // 差出人名（空なら SMTP_FROM_NAME）
  bccStaff: boolean;     // 運営にも同じ内容を送る
  subject: string;       // {{氏名}} 等の差し込み可
  blocks: AutoReplyBlock[];
}
export const DEFAULT_AUTO_REPLY: AutoReply = {
  enabled: false,
  fromName: "",
  bccStaff: false,
  subject: "【KAWAI CAMP】ご回答ありがとうございました",
  blocks: [],
};

/**
 * 会員未登録のメールアドレス（マスタ ＞ 未登録メール）。
 *   フォーム回答・決済情報に出てくるのに members に居ないアドレスを
 *   1メール＝1行にまとめたもの。集計は /api/ops/unregistered-emails で行う。
 */
export interface UnregisteredEmail {
  email: string;
  /** 直近に確認できた氏名（空のこともある） */
  name: string;
  /** 由来（フォーム名／「決済」）。重複は除く */
  origins: string[];
  formCount: number;
  paymentCount: number;
  /** 合計決済額（円）。決済が無ければ 0 */
  amount: number;
  /** 最初に現れた日時 */
  firstAt: string;
  /** 最後に現れた日時。一覧の「登録日時」はこちらを出す */
  lastAt: string;
  /** 運営メモ（unregistered_notes） */
  note: string;
  noteBy: string;
  noteAt: string;
  /** 明細（新しい順）。詳細で「いつ・どこから来たか」を追うのに使う */
  events: UnregisteredEvent[];
}

/** 未登録メールの1件の記録（フォーム回答 or 決済） */
export interface UnregisteredEvent {
  at: string;
  kind: "form" | "payment";
  /** フォーム名 or 商品名・決済サイト */
  label: string;
  /** 決済額（円）。フォームは 0 */
  amount: number;
}

/** 自動返信メールで使える差し込みトークン（設問は {{Q:設問名}}） */
export const AUTO_REPLY_VARIABLES: { token: string; label: string }[] = [
  { token: "{{氏名}}",         label: "氏名" },
  { token: "{{メール}}",       label: "メールアドレス" },
  { token: "{{フォーム名}}",   label: "フォーム名" },
  { token: "{{回答日時}}",     label: "回答日時" },
  { token: "{{回答内容ぜんぶ}}", label: "全回答（設問名：回答の一覧）" },
];

export interface FormDesign {
  color: string;         // メインカラー
  bgColor: string;       // 背景色
  headerImage: string;   // ヘッダー画像URL
  submitLabel: string;   // 送信ボタン文言
  progress: boolean;     // プログレスバー
  customCss: string;
  /** 未ログイン回答者向けのご連絡先欄。旧データには無いので読み込み時に既定で補完する。 */
  guestContact: GuestContact;
  /**
   * 回答後に表示する画面の種類。旧データには無いので thanks_url の有無から補完する。
   * ⚠️ 専用列は作らず design(jsonb) に入れる（guestContact と同じ方針）。
   */
  thanksMode: ThanksMode;
  /** thanksMode === "html" のときの本文（保存時にサニタイズ済み） */
  thanksHtml: string;
  /** 回答者本人への自動返信メール */
  autoReply: AutoReply;
}
export const DEFAULT_FORM_DESIGN: FormDesign = {
  color: "#dc2626", bgColor: "#f7f7f8", headerImage: "",
  submitLabel: "送信する", progress: true, customCss: "",
  guestContact: { ...DEFAULT_GUEST_CONTACT },
  thanksMode: "text", thanksHtml: "",
  autoReply: { ...DEFAULT_AUTO_REPLY, blocks: [] },
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
  /** 回答期限をカレンダーに表示する */
  showOnCalendar: boolean;
  /** カレンダー表示名（空ならフォーム名） */
  calendarLabel: string;
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
