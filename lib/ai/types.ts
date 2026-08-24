// ============================================================
// AI機能の共有型（クライアント / サーバー 双方で使う）
// ============================================================

/** ai_logs.feature に入る値 */
export type AiFeature =
  | "member_consult"
  | "escalate"
  | "reply_suggest"
  | "review"
  | "html_generate"
  | "door_generate"
  | "broadcast_draft"
  | "data_search"
  | "bookmark_gen"
  | "summarize"
  | "adopt"
  | "payment_extract"
  | "bot_public";

// ── ① メンバー AI相談 ────────────────────────────────────────
export interface AiCitation {
  kind: "content" | "news";
  id: number;
  title: string;
}

export interface AiConsultReq {
  aiConversationId?: number | null;
  message: string;
}

export interface AiConsultRes {
  aiConversationId: number;
  answer: string;
  citations: AiCitation[];
  escalate: boolean;
  /** 事務局へ引き継ぐ場合に、本人が送る文面の下書き */
  handoffDraft: string;
  /** 本日の残り相談回数 */
  remaining: number;
  /** ai_traces.id。評価UIがこれを使う */
  traceId?: number | null;
}

/** 過去スレッド一覧の1件（B-4） */
export interface AiConsultThread {
  id: number;
  /** 空なら最終発言の先頭を使う */
  title: string;
  lastAt: string;
  messageCount: number;
  /** 事務局へ引き継ぎ済み */
  escalated: boolean;
}

/** 画面に並べる1発言 */
export interface AiConsultTurn {
  id: number;
  role: "user" | "assistant";
  body: string;
  citations: AiCitation[];
  escalate: boolean;
  createdAt: string;
}

// ── ② 返信提案（オペ向け AI相談チャット）─────────────────────
export type AiTone = "standard" | "polite" | "casual";
export type AiLength = "standard" | "short" | "long";

export interface AiDraft {
  label: string;          // "案 A"
  tone: string;           // "謝罪＋即対応"
  text: string;           // 顧客に送る本文
  basis: string[];        // 根拠
  needsInput: string[];   // [要確認: 〜] の一覧
}

export interface ReplySuggestReq {
  conversationId: number;
  action: "generate" | "chat" | "reset";
  tone?: AiTone;
  length?: AiLength;
  count?: 1 | 2 | 3;
  message?: string;
  /**
   * ⚠️ A-3 で廃止。クライアントは相談履歴を送らない。
   *    履歴はサーバー（ai_consult_sessions）から組み立てる。
   *    互換のため型は残すが、サーバーは読まない。
   * @deprecated
   */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface ReplySuggestRes {
  talk: string;
  drafts: AiDraft[];
  usedContext: { messages: number; knowledge: number };
  /** 相談セッションID（A-3）。画面は表示に使わないが、追跡できるよう返す */
  sessionId?: number | null;
}

/** LINEトーク向け返信提案（Phase 3）。conversationId の代わりに friendId。 */
export interface LineReplySuggestReq {
  friendId: number;
  action: "generate" | "chat" | "reset";
  tone?: AiTone;
  length?: AiLength;
  count?: 1 | 2 | 3;
  message?: string;
  /** @deprecated A-3 で廃止。サーバーは読まない。 */
  history?: { role: "user" | "assistant"; content: string }[];
}

/** AiPanel に積み上がる1ターン */
export type AiTurn =
  | { kind: "system"; id: string; text: string }
  | { kind: "op"; id: string; text: string }
  | { kind: "talk"; id: string; text: string }
  | { kind: "draft"; id: string; draft: AiDraft };

// ── ③ 添削 ───────────────────────────────────────────────────
export type ReviewSeverity = "critical" | "warning" | "suggest";
export type ReviewAspect = "typo" | "risk" | "tone" | "concise";

export const REVIEW_ASPECTS: { key: ReviewAspect; label: string }[] = [
  { key: "typo", label: "誤字・敬語" },
  { key: "risk", label: "リスク表現" },
  { key: "tone", label: "トーン" },
  { key: "concise", label: "簡潔さ" },
];

export interface ReviewIssue {
  severity: ReviewSeverity;
  category: string;
  quote: string;
  reason: string;
  fix: string;
}

export interface ReviewReq {
  draft: string;
  conversationId?: number | null;
  aspects?: ReviewAspect[];
}

export interface ReviewRes {
  issues: ReviewIssue[];
  revised: string;
  stats: { before: number; after: number };
}

// ── ④ HTML生成 ───────────────────────────────────────────────
export interface HtmlGenerateReq {
  instruction: string;
  currentHtml: string;
  selection?: { start: number; end: number } | null;
}

// 実体は lib/ai-core/guardrails/sanitize.ts（Ph3）。既存の import を壊さないよう再輸出する。
import type { HtmlSanitizeInfo } from "../ai-core/guardrails/sanitize";
export type { HtmlSanitizeInfo };

export interface HtmlGenerateRes {
  html: string;
  sanitized: HtmlSanitizeInfo;
  replaceRange: { start: number; end: number } | null;
}

// ── ⑧ 扉ページHTML生成 ───────────────────────────────────────
//   ④とは許可タグ・使うclass・データ注入の仕組みが違うため機能を分ける。
//   sectionId は必須：配下ページの slug をサーバー側で実データとして渡し、
//   AIに slug を創作させないため（存在しない slug は描画時に要素ごと消える）。
export interface DoorGenerateReq {
  instruction: string;
  /** 現在の door_html（全文） */
  currentHtml: string;
  /** 対象セクション（content_sections.id）。未保存(0)は不可 */
  sectionId: number;
  selection?: { start: number; end: number } | null;
}

/** 扉ページの生成結果。レスポンス形は ④ と同じ */
export type DoorGenerateRes = HtmlGenerateRes;

/** AIチャットのプレビューに渡す最小のページ情報（slug と名前だけ） */
export interface DoorSeedPage {
  id: number;
  slug: string;
  name: string;
  coverUrl: string;
}

// ── ⑤ 配信原稿生成 ───────────────────────────────────────────
export type BcPurpose = "announce" | "remind" | "report" | "survey" | "reengage";
export type BcTone = "friendly" | "formal" | "concise";
export type BcLength = "short" | "standard" | "long";
export type BcEmoji = "none" | "few" | "many";

export const BC_PURPOSE_LABEL: Record<BcPurpose, string> = {
  announce: "イベント告知・申込促進",
  remind: "リマインド",
  report: "お知らせ・報告",
  survey: "アンケート依頼",
  reengage: "再エンゲージメント（休眠向け）",
};
export const BC_TONE_LABEL: Record<BcTone, string> = {
  friendly: "親しみやすい",
  formal: "丁寧・フォーマル",
  concise: "簡潔・事務的",
};
export const BC_LENGTH_LABEL: Record<BcLength, string> = {
  short: "短め（〜120字）",
  standard: "標準（200〜300字）",
  long: "詳しめ（400字〜）",
};
export const BC_EMOJI_LABEL: Record<BcEmoji, string> = {
  none: "使わない",
  few: "控えめ",
  many: "多め",
};

export interface BcTarget {
  targetMode: "all" | "filter";
  targetAttrIds: number[];
  /** Phase 3：流入経路（sources.id）。旧 targetSource(単一キー) から置換。 */
  targetSourceIds: number[];
  /** Phase 3：カテゴリ一括（例: ["ad"]） */
  targetSourceCats: string[];
}

export interface BroadcastDraftReq {
  purpose: BcPurpose;
  tone: BcTone;
  length: BcLength;
  emoji: BcEmoji;
  points: string;
  target: BcTarget;
  useVariables: boolean;
  useAudience: boolean;
}

export interface BcDraft {
  label: string;     // "案 A"
  approach: string;  // "共感型"
  text: string;
}

export interface BcWarning {
  level: "ok" | "warn" | "info";
  message: string;
}

export interface BroadcastDraftRes {
  drafts: BcDraft[];
  warnings: BcWarning[];
  audience: { total: number; breakdown: Record<string, number> };
}

export interface BroadcastCheckReq {
  messageBody: string;
  target: BcTarget;
}
export interface BroadcastCheckRes {
  checks: BcWarning[];
}

// ── ⑥ データ検索 ─────────────────────────────────────────────
//   呼び出し元の画面で参照できるデータ範囲(scope)が決まる。
//   scope ごとにサーバーの「許可済み集計/抽出関数」だけが実行される。
export type SearchScope = "members" | "chat_stats" | "contents" | "payments";

export const SEARCH_SCOPE_LABEL: Record<SearchScope, string> = {
  members: "会員データ",
  chat_stats: "チャット統計",
  contents: "コンテンツ・お知らせ",
  payments: "決済データ",
};

export interface DataSearchReq {
  scope: SearchScope;
  query: string;
}

/** AIが返す汎用テーブル（列名→値） */
export type DataSearchRow = Record<string, string | number | null>;

export interface DataSearchRes {
  summary: string;
  columns: string[];
  rows: DataSearchRow[];
  source: string;
  period: string;
  /** 本日の残り回数 */
  remaining: number;
}

// ── 回答への評価（A-8）─────────────────────────────────────
//   評価データセットの元。ここが貯まらないと改善の効果を数字で言えない。
export interface AiFeedbackReq {
  traceId: number;
  /** 1 役に立った / -1 役に立たなかった */
  rating: 1 | -1;
  /** 「悪い」のときの理由（選択肢の値。自由記述は受け取らない） */
  reason?: string;
  /** 体験版URLから押された場合 */
  shareToken?: string | null;
}

/** 「役に立たなかった」の理由。自由記述にしないのは、集計できる形で貯めるため。 */
export const FEEDBACK_REASONS = [
  { key: "irrelevant", label: "質問と関係ない" },
  { key: "incomplete", label: "答えになっていない" },
  { key: "wrong",      label: "内容が間違っている" },
  { key: "outdated",   label: "情報が古い" },
  { key: "tone",       label: "言い方が気になる" },
  { key: "other",      label: "その他" },
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["key"];

// ── プロンプト管理（管理画面 ⇄ サーバー）─────────────────────
export interface AiPromptItem {
  feature: AiFeature;
  label: string;
  /** 編集可能な役割・方針（DB or 既定） */
  body: string;
  /** コードの既定値（「既定に戻す」用） */
  defaultBody: string;
  /** 固定の出力契約（表示のみ） */
  contract: string;
  /** DBに保存済みか（false＝既定値を表示中） */
  saved: boolean;
  model: string | null;
  temperature: number | null;
  updatedAt: string | null;
}

export interface AiPromptSaveReq {
  feature: AiFeature;
  body: string;
  model?: string | null;
  temperature?: number | null;
}

export interface AiPromptPreviewReq {
  feature: AiFeature;
  body: string;
  sample: string;
}

export interface AiPromptPreviewRes {
  preview: string;
}

// ── 回答トレース（Ph0：管理画面 ⇄ サーバー）─────────────────
/** 一覧の絞り込み（状態） */
export type AiTraceState =
  | "refused" | "error" | "needs_human" | "retried"
  /** 利用者が「役に立たなかった」と評価した回答。評価ケースの元になる */
  | "rated_bad";

/** 一覧の1行。重い列（system / messages）は含まない。 */
export interface AiTraceRow {
  id: number;
  createdAt: string;
  feature: string;
  entry: string;
  requestId: string;
  /** 先頭120字まで */
  userInput: string;
  model: string;
  confidence: number | null;
  refused: boolean;
  needsHuman: boolean;
  ok: boolean;
  retryCount: number;
  tokensIn: number;
  tokensOut: number;
  /** 0 は「単価未設定」であって「無料」ではない */
  costJpy: number;
  latencyMs: number;
  totalMs: number;
  sourceCount: number;
  error: string | null;
  /** 利用者の評価。1 良い / -1 悪い / null 未評価 */
  rating: number | null;
}

export interface AiTraceFeedback {
  rating: number;      // -1 悪い / 1 良い
  reason: string;
  createdAt: string;
}

/** 詳細。LLMへ送った全文を含む。 */
export interface AiTraceDetail {
  id: number;
  createdAt: string;
  feature: string;
  entry: string;
  requestId: string;
  memberId: number | null;
  subjectKey: string;
  userInput: string;
  rewrittenQuery: string | null;
  systemPrompt: string;
  messagesJson: unknown[];
  promptVersion: string;
  retrieval: unknown[];
  usedSources: unknown[];
  answer: string;
  confidence: number | null;
  refused: boolean;
  needsHuman: boolean;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  tokensIn: number;
  tokensOut: number;
  costJpy: number;
  latencyMs: number;
  totalMs: number;
  retryCount: number;
  ok: boolean;
  error: string | null;
  feedback: AiTraceFeedback[];
}

/** 検索の候補と採点（retrieval_json の1要素） */
export interface AiRetrievalItem {
  src?: string;
  id?: number | string;
  title?: string;
  vec?: number;
  kw?: number;
  score?: number;
  used?: boolean;
}

/** 利用状況（機能別の集計） */
export interface AiUsageSummaryRow {
  feature: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costJpy: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
  refused: number;
}
