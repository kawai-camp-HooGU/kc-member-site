// ============================================================
// AI Core の公開API（Ph3）
//
//   新しいプロジェクトが AI 機能を載せるとき、触る面はここだけにする。
//   Core は「文脈をどう組み立てて、どう問い合わせて、どう記録するか」を持ち、
//   「何をどこから取るか」は持たない。取得は PJ 側が行い、値として渡す。
//
//   ⚠️ ここに PJ固有のテーブル名（members / contents / chat_messages …）を
//      書き始めたら、境界を踏み越えている。渡す側へ寄せること。
// ============================================================
import { callClaudeEx, type AiMessage, type RetrievalTrace } from "./gateway/llm";
import { retrieveKnowledge, type KnowledgeRow } from "./rag/retrieve";
import { loadProjectConfig, type ProjectConfig } from "./config/project";
import { wrap } from "./guardrails/delimiter";
import { maskText } from "./guardrails/pii";

export type { ProjectConfig, KnowledgeRow, AiMessage, RetrievalTrace };
export { loadProjectConfig, retrieveKnowledge, wrap, maskText };

/** 回答に使った出典の最小形。表示の作法は PJ 側に任せる。 */
export interface SourceRef {
  kind: string;
  id: number | string;
  title: string;
  url: string | null;
  excerpt: string;
  score: number;
}

export interface AskInput {
  /** ai_projects.slug */
  projectSlug: string;
  /** ai_prompts.feature と同じキー */
  feature: string;
  question: string;
  /** LLM へ渡す system。PJ 側で loadPromptBundle() を通して作る */
  system: string;
  /** ai_traces.prompt_version に入れる版 */
  promptVersion?: string;

  /**
   * PJ 側が用意した文脈。Core はこれを組み立てるだけで、取得はしない。
   *   knowledge を渡さず retrieve を指定した場合は Core が検索する。
   */
  context?: {
    knowledge?: KnowledgeRow[];
    profile?: string;
    history?: AiMessage[];
    /** 追加の資料。タグ名 → 本文 */
    extra?: Record<string, string>;
  };

  /** Core に検索させる場合の指定（context.knowledge を渡したときは無視） */
  retrieve?: {
    /** 祖先を展開済みのメンバー属性ID。null＝会員限定の文書を出さない */
    memberAttrs?: number[] | null;
    sourceTypes?: string[] | null;
  };

  caller: {
    memberId: number | null;
    entry?: string;
    subjectKey?: string;
  };
  requestId?: string;
  /** 上限。未指定なら Core 既定 */
  maxTokens?: number;
  temperature?: number;
  model?: string;
  startedAt?: number;
}

export interface AskResult {
  answer: string;
  usedSources: SourceRef[];
  /** 採用した断片のスコアから出す 0〜1。根拠が無ければ null */
  confidence: number | null;
  /** 根拠が薄く、人へ引き継ぐべきと判断した */
  needsHuman: boolean;
  /** 該当なし・スコープ外で定型を返した */
  refused: boolean;
  traceId: number | null;
}

const toSource = (r: KnowledgeRow): SourceRef => ({
  kind: r.sourceType,
  id: r.chunkId,
  title: r.title ?? "",
  url: r.url,
  excerpt: (r.text ?? "").slice(0, 140),
  score: r.score,
});

/**
 * 採用した断片から信頼度を出す。
 *   上位1件のスコアをそのまま使う。件数で薄めない
 *   （関係ない断片が3件あることは、良い1件の価値を下げない）。
 */
function confidenceOf(rows: KnowledgeRow[]): number | null {
  if (rows.length === 0) return null;
  const top = Math.max(...rows.map((r) => r.score ?? 0));
  return Math.min(1, Math.max(0, top));
}

/**
 * 質問に答える。
 *   ⚠️ 根拠が1件も無いときは LLM を呼ばない。
 *      呼んでも資料が無いので作り話になるだけで、費用だけがかかる。
 */
export async function ask(input: AskInput): Promise<AskResult> {
  const cfg = await loadProjectConfig(input.projectSlug);

  // ── 根拠を用意する（渡されていれば検索しない）──
  let rows = input.context?.knowledge ?? null;
  if (rows === null && input.retrieve) {
    rows = await retrieveKnowledge(input.question, cfg.retrieval.top_k, {
      memberAttrIds: input.retrieve.memberAttrs ?? null,
      sourceTypes: input.retrieve.sourceTypes ?? null,
    });
  }
  const knowledge = rows ?? [];

  if (knowledge.length === 0 && !input.context?.profile) {
    return {
      answer: "", usedSources: [], confidence: null,
      needsHuman: true, refused: true, traceId: null,
    };
  }

  // ── 文脈を組み立てる ──
  //   ★ タグで囲むのは間接プロンプトインジェクション対策。
  //     マスキングはこの直前に済ませる（トレースにも伏せた値だけが残る）。
  const parts: string[] = [];
  if (input.context?.profile) parts.push(wrap("profile", maskText(input.context.profile)));
  if (knowledge.length > 0) {
    const body = knowledge
      .map((r) => `[${r.sourceType}] ${r.title ?? ""}\n${maskText((r.text ?? "").slice(0, 600))}`)
      .join("\n\n");
    parts.push(wrap("knowledge", body));
  }
  for (const [tag, text] of Object.entries(input.context?.extra ?? {})) {
    if (text) parts.push(wrap(tag, maskText(text)));
  }
  parts.push(wrap("question", maskText(input.question)));

  const messages: AiMessage[] = [
    ...(input.context?.history ?? []),
    { role: "user", content: parts.join("\n\n") },
  ];

  const retrieval: RetrievalTrace[] = knowledge.map((r) => ({
    src: r.sourceType, id: r.chunkId, title: r.title ?? "",
    vec: r.vec, kw: r.kw, score: r.score, used: true,
  }));
  const usedSources = knowledge.map(toSource);

  const res = await callClaudeEx({
    feature: input.feature,
    system: input.system,
    messages,
    model: input.model ?? cfg.model.default ?? undefined,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    callerMemberId: input.caller.memberId,
    requestId: input.requestId,
    entry: input.caller.entry,
    subjectKey: input.caller.subjectKey,
    userInput: input.question,
    promptVersion: input.promptVersion,
    retrieval,
    usedSources,
    startedAt: input.startedAt,
  });

  const answer = (res.text ?? "").trim();
  const confidence = confidenceOf(knowledge);

  return {
    answer,
    usedSources,
    confidence,
    // 根拠が無い／答えが空 → 人へ引き継ぐ
    needsHuman: !answer || knowledge.length === 0,
    refused: !answer,
    traceId: res.traceId,
  };
}
