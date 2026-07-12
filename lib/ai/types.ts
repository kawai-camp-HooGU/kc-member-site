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
  | "broadcast_draft"
  | "summarize"
  | "adopt";

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
  action: "generate" | "chat";
  tone?: AiTone;
  length?: AiLength;
  count?: 1 | 2 | 3;
  message?: string;
  /** クライアントが保持している相談チャット履歴 */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface ReplySuggestRes {
  talk: string;
  drafts: AiDraft[];
  usedContext: { messages: number; knowledge: number };
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

export interface HtmlSanitizeInfo {
  removedTags: string[];
  removedAttrs: string[];
  externalLinks: string[];
}

export interface HtmlGenerateRes {
  html: string;
  sanitized: HtmlSanitizeInfo;
  replaceRange: { start: number; end: number } | null;
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
