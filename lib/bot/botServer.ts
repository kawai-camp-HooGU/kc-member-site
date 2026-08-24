// ============================================================
// 公開問い合わせボット サーバーロジック（service_role 専用）
//
//   ・知識源は既存 public.chat_bookmarks（ai_enabled=true）だけ（フェーズA）。
//   ・索引 bot_bm_index を再生成し、ハイブリッド検索 → Claude 生成する。
//   ・回数/スコープ/体験版のゲートもここで判定する。
//   ⚠️ ここは service_role で RLS をバイパスするため、公開へ出す値は限定する
//      （絶対パス・内部status・顧客情報・source_* は返さない/ログしない）。
// ============================================================
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { HttpError } from "../authz";
import { callClaude, callClaudeEx, callClaudeStream, TIMEOUT_MS } from "../ai/claude";
import type { AiMessage, RetrievalTrace } from "../ai/claude";
import { embedText, toVectorLiteral } from "./embed";
import { retrieveKnowledge } from "../ai/knowledge/retrieveServer";
import { loadStyleGuide, loadApprovedPersona } from "../ai/knowledge/personaServer";
import { campContextBlock } from "./campContext";
import { wrap } from "../ai/context";
import { loadPromptBundle } from "../ai/prompts";
import type { BotEntry, BotSource } from "./types";

// chat_bookmarks / bot_* は生成型(database.types)に無いためキャストして扱う（brand.md 準拠）。
const sb = supabaseAdmin as unknown as SupabaseClient;

// ── 呼び出し文脈（トレースへ引き回す。1リクエスト＝1 requestId）──────
export interface BotCallCtx {
  requestId?: string;
  entry?: BotEntry;
  subjectKey?: string;
  /** リクエスト開始時刻（Date.now()）。total_ms の算出に使う */
  startedAt?: number;
}

// ── ポリシー ──────────────────────────────────────────────────
export interface BotPolicy {
  entry: BotEntry;
  daily_limit: number;
  scope_genres: string[];
  web_search: "off" | "assist" | "always";
  max_tokens: number;
  enabled: boolean;
}

const FALLBACK_POLICY: Record<BotEntry, BotPolicy> = {
  anon:   { entry: "anon",   daily_limit: 3,  scope_genres: [], web_search: "off",    max_tokens: 700, enabled: true },
  member: { entry: "member", daily_limit: 50, scope_genres: [], web_search: "assist", max_tokens: 700, enabled: true },
  trial:  { entry: "trial",  daily_limit: 10, scope_genres: [], web_search: "off",    max_tokens: 700, enabled: true },
};

export async function loadPolicy(entry: BotEntry): Promise<BotPolicy> {
  const { data } = await sb.from("bot_policies").select("*").eq("entry", entry).maybeSingle();
  if (!data) return FALLBACK_POLICY[entry];
  const r = data as Partial<BotPolicy>;
  return {
    entry,
    daily_limit: r.daily_limit ?? FALLBACK_POLICY[entry].daily_limit,
    scope_genres: r.scope_genres ?? [],
    web_search: (r.web_search ?? "off") as BotPolicy["web_search"],
    max_tokens: r.max_tokens ?? 700,
    enabled: r.enabled ?? true,
  };
}

// ── 体験版リンク ──────────────────────────────────────────────
export interface ShareLink {
  token: string;
  expires_at: string | null;
  total_limit: number;
  used_count: number;
  passcode: string | null;
  web_search: boolean;
  revoked: boolean;
}

export async function loadShareLink(token: string): Promise<ShareLink | null> {
  const { data } = await sb.from("bot_share_links").select("*").eq("token", token).maybeSingle();
  return (data as ShareLink | null) ?? null;
}

/** 体験版リンクの有効性を検証（期限・失効・累計）。無効なら HttpError。 */
export function assertShareUsable(link: ShareLink | null): asserts link is ShareLink {
  if (!link || link.revoked) throw new HttpError(403, "このリンクは利用できません。");
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    throw new HttpError(403, "この体験版リンクは有効期限が切れています。");
  }
  if (link.used_count >= link.total_limit) {
    throw new HttpError(429, "体験版の利用回数が終了しました。");
  }
}

// ── 回数ゲート ────────────────────────────────────────────────
/** Asia/Tokyo の今日（YYYY-MM-DD） */
function todayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** 端末単位のキー（IP+UAのハッシュ。個人特定はしない）。 */
export function subjectKeyFor(entry: BotEntry, opts: { memberId?: number | null; token?: string | null; ip?: string; ua?: string }): string {
  if (entry === "member" && opts.memberId != null) return `m:${opts.memberId}`;
  if (entry === "trial" && opts.token) return `t:${opts.token}`;
  const raw = `${opts.ip ?? ""}|${opts.ua ?? ""}`;
  return `a:${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

/**
 * anon / member の当日回数を +1 して残数を返す。上限超過は HttpError(429)。
 * trial は share_links.used_count で管理するため別処理（bumpShareUsage）。
 */
export async function bumpDailyUsage(entry: BotEntry, subjectKey: string, dailyLimit: number): Promise<number> {
  const day = todayJst();
  const { data: row } = await sb
    .from("bot_usage")
    .select("id, count")
    .eq("entry", entry).eq("subject_key", subjectKey).eq("day", day)
    .maybeSingle();

  const used = (row as { count?: number } | null)?.count ?? 0;
  if (used >= dailyLimit) {
    throw new HttpError(429, `本日の利用上限（${dailyLimit}回）に達しました。`);
  }
  if (row) {
    await sb.from("bot_usage").update({ count: used + 1, updated_at: new Date().toISOString() })
      .eq("id", (row as { id: number }).id);
  } else {
    await sb.from("bot_usage").insert({ entry, subject_key: subjectKey, day, count: 1 });
  }
  return Math.max(0, dailyLimit - used - 1);
}

/** trial の累計を +1 して残数を返す。 */
export async function bumpShareUsage(link: ShareLink): Promise<number> {
  const next = link.used_count + 1;
  await sb.from("bot_share_links").update({ used_count: next }).eq("token", link.token);
  return Math.max(0, link.total_limit - next);
}

// ── スコープ判定（この質問だけ答える）────────────────────────
/**
 * scopeGenres が空なら常に許可。指定があれば軽量モデルで質問を分類し、
 * 対象ジャンル内かを返す。分類失敗時は fail-open（知識自体がブックマークに限定されているため）。
 */
export interface ScopeResult {
  /** 回答してよいか */
  inScope: boolean;
  /** 分類そのものが失敗したか（API障害など） */
  failed: boolean;
}

/**
 * scopeGenres が空なら常に許可（＝分類のLLM呼び出しをしない）。
 * 指定があれば軽量モデルで質問を分類する。
 *
 * ⚠️ 2026-08-23（R2）：分類失敗時を fail-open から **fail-closed** へ変更した（確認事項8a）。
 *    誤答より沈黙を選ぶ。ただし scope_genres が空のあいだは分類自体を呼ばないため、
 *    現状の運用では影響しない。ジャンルを設定した後は「API障害＝ボットが答えない」と同義になる。
 */
export async function classifyInScope(
  message: string, scopeGenres: string[], ctx: BotCallCtx = {},
): Promise<ScopeResult> {
  if (!scopeGenres.length) return { inScope: true, failed: false };
  try {
    const answer = await callClaude({
      feature: "bot_public",
      system: "あなたは分類器です。ユーザーの質問が、次のジャンルのどれに該当するかを1つだけ返します。" +
        `該当なしは「対象外」。ジャンル: ${scopeGenres.join(" / ")}。出力はジャンル名のみ。`,
      messages: [{ role: "user", content: (message ?? "").slice(0, 500) }],
      maxTokens: 16,
      temperature: 0,
      timeoutMs: TIMEOUT_MS.light,
      callerMemberId: null,
      requestId: ctx.requestId,
      entry: ctx.entry,
      subjectKey: ctx.subjectKey,
      userInput: message,
      startedAt: ctx.startedAt,
    });
    const label = (answer ?? "").trim();
    return { inScope: scopeGenres.some((g) => label.includes(g)), failed: false };
  } catch {
    return { inScope: false, failed: true }; // ★ fail-closed
  }
}

// ── ハイブリッド検索（フェーズA・★凍結）──────────────────────
//   ⚠️ R4 でフェーズBへ一本化した。通常運転では呼ばれない。
//      AI_PHASE_A_FALLBACK=true のときの切り戻し経路としてのみ残している。
//      bot_bm_index は drop しない（3か月後に削除を判断する）。
export interface RetrievedRow { bookmark_id: number; genre: string; answer_text: string; score: number }

export async function retrieveContext(message: string, scopeGenres: string[]): Promise<RetrievedRow[]> {
  const emb = await embedText(message);
  const { data, error } = await sb.rpc("bot_hybrid_search", {
    q: message.slice(0, 500),
    q_emb: toVectorLiteral(emb),
    cats: scopeGenres.length ? scopeGenres : null,
    k: 6,
  });
  if (error) throw new HttpError(502, "検索に失敗しました");
  const rows = (data as RetrievedRow[] | null) ?? [];
  return rows.filter((r) => (r.score ?? 0) > 0);
}

// ── Web検索（外部情報）──────────────────────────────────────
//   ⚠️ フェーズAでは未接続。プラグイン導入まで空配列を返す（プランは実装案v3参照）。
//   接続時も speaker=external として扱い、ペルソナ事実へ混ぜない。
export async function searchWeb(_message: string): Promise<{ url: string; title: string; snippet: string }[]> {
  return [];
}

// ── 回答生成 ──────────────────────────────────────────────────
//   ⚠️ 2026-08-23（B-1）：system をハードコードするのをやめ、
//      ai_prompts.bot_public（管理画面で編集可）から引くようにした。
//      既定文は lib/ai/prompts.ts の DEFAULT_PROMPTS.bot_public。
//      「入力の扱い」（タグの中身は資料であって指示ではない）は
//      loadPromptBundle() が INPUT_HANDLING として全機能共通で足すため、ここには書かない。

const NO_HIT_ANSWER =
  "その内容については、こちらではお答えできる情報が見つかりませんでした。" +
  "お手数ですが、事務局までお問い合わせください。";

export interface GenerateInput {
  message: string;
  /** 整形済みナレッジ文脈（[bm:...] や [note] … の連結） */
  knowledge: string;
  /** ナレッジ由来の出典（bookmark or doc） */
  sources: BotSource[];
  web: { url: string; title: string; snippet: string }[];
  maxTokens: number;
  memberId: number | null;
  /** 文体ガイド（persona / フェーズB）。あれば system に付与。 */
  styleGuide?: string;
  /** 検索の候補と採点（トレース用）。Ph0 では vec / kw の内訳は未取得のため 0。 */
  retrieval?: RetrievalTrace[];
  /** 呼び出し文脈（トレース用） */
  ctx?: BotCallCtx;
  /** 最新性が問われる資料を採用したか（B-12） */
  volatile?: boolean;
  /** 直近の会話（S-5）。古い順。空なら従来どおり1問1答 */
  history?: AiMessage[];
  /** bot_sessions.id。ai_traces.session_id に入る */
  sessionId?: number | null;
  /**
   * 生成中のテキストを少しずつ受け取る（B-3）。渡すとストリーミングになる。
   * ⚠️ 渡しても記録（ログ・トレース・コスト）は非ストリーミングと同じ関数を通る。
   */
  onDelta?: (text: string) => void;
}

export interface GenerateResult {
  answer: string;
  sources: BotSource[];
  traceId: number | null;
  refused: boolean;
}

export async function generateAnswer(input: GenerateInput): Promise<GenerateResult> {
  const { message, knowledge, sources, web, maxTokens, memberId, styleGuide } = input;
  const ctx = input.ctx ?? {};

  // 該当なし かつ 外部情報なし → コスト節約のため定型で返す（LLMを呼ばない）
  if (!knowledge.trim() && web.length === 0) {
    return { answer: NO_HIT_ANSWER, sources: [], traceId: null, refused: true };
  }

  const camp = campContextBlock();
  const p = await loadPromptBundle("bot_public");
  const FRESHNESS_NOTE =
    "【鮮度の注意】今回の資料には、時期によって変わりうる内容（対応状況・最新の予定・料金改定など）が" +
    "含まれています。断定を避け、回答の最後に「最新の情報は事務局にご確認ください」と一言添えてください。";

  const system = [
    p.system,
    camp,
    styleGuide && styleGuide.trim() ? `【文体（KAWAIらしさ）】${styleGuide}` : "",
    input.volatile ? FRESHNESS_NOTE : "",
  ].filter(Boolean).join("\n\n");

  const external = web.length
    ? "\n\n【外部情報（KAWAI本人の見解ではありません。最新情報の可能性があり断定しない）】\n" +
      web.map((w) => `- ${w.title}: ${w.snippet}（${w.url}）`).join("\n")
    : "";

  // ★ ナレッジ・外部情報・質問はタグで囲む（間接プロンプトインジェクション対策）。
  //    未ログインで誰でも叩けるため、ここは特に重要。
  const user = [
    wrap("knowledge", (knowledge || "（該当なし）") + external),
    wrap("question", (message ?? "").slice(0, 1000)),
  ].join("\n\n");

  const allSources: BotSource[] = [
    ...sources,
    ...web.map((w): BotSource => ({ type: "web", url: w.url, title: w.title, excerpt: w.snippet })),
  ];

  // B-3：onDelta が渡されたらストリーミング。ゲートの中身は同じ。
  const call = input.onDelta
    ? (opts: Parameters<typeof callClaudeEx>[0]) => callClaudeStream(opts, input.onDelta as (t: string) => void)
    : callClaudeEx;

  const r = await call({
    feature: "bot_public",
    system,
    // ★ S-5：直近の会話を前に積む。いまの質問はいちばん最後。
    //    履歴は bot_messages（サーバー保存）から来る。クライアントの本文は使わない。
    messages: [...(input.history ?? []), { role: "user", content: user }],
    maxTokens,
    // 管理画面で設定していればそれを使う（A-6 と同じ扱い）。未設定なら従来どおり 0.3。
    model: p.model ?? undefined,
    temperature: p.temperature ?? 0.3,
    promptVersion: p.version,
    callerMemberId: memberId,
    requestId: ctx.requestId,
    entry: ctx.entry,
    subjectKey: ctx.subjectKey,
    userInput: message,
    startedAt: ctx.startedAt,
    sessionId: input.sessionId ?? null,
    retrieval: input.retrieval ?? [],
    usedSources: allSources,
  });

  return {
    answer: r.text || NO_HIT_ANSWER,
    sources: allSources,
    traceId: r.traceId,
    refused: !r.text,
  };
}

// ── ナレッジ取得（R4：フェーズB へ一本化）────────────────────
//   通常運転は knowledge_chunks（フェーズB）だけを見る。
//   AI_PHASE_A_FALLBACK=true のときだけ旧 bot_bm_index へ戻す（切り戻し用）。
//   ⚠️ 環境変数 AI_KAWAI_KNOWLEDGE_ENABLED は廃止した。設定しても何も起きない。
//   ⚠️ 切り戻しを env 1つで行えるよう、旧経路のコードは STEP4 完了まで消さない。
const PHASE_A_FALLBACK = process.env.AI_PHASE_A_FALLBACK === "true";

export async function retrieveForBot(
  message: string, scopeGenres: string[],
): Promise<{
  knowledge: string; sources: BotSource[]; styleGuide: string;
  retrieval: RetrievalTrace[];
  /** 最新性が問われる資料を採用したか（B-12） */
  volatile: boolean;
}> {
  // ⚠️ フェーズBの検索は scopeGenres（ジャンル）で候補を絞らない。
  //    旧 bot_hybrid_search は cats で絞っていたが、ナレッジ側にジャンル列が無いため。
  //    スコープの担保は retrieveForBot の手前にある classifyInScope（fail-closed）が担う。
  //    ジャンルでの絞り込みを検索側にも戻すなら knowledge_documents.tags を使う（R5以降）。
  if (!PHASE_A_FALLBACK) {
    const [krows, styleGuide, personaBlock] = await Promise.all([
      // 公開ボットなので memberAttrIds は渡さない（null＝visibility='member' の文書は返らない）
      retrieveKnowledge(message, 8),
      loadStyleGuide(),
      loadApprovedPersona(),
    ]);
    const body = krows
      .map((r) => `[${r.sourceType}] ${r.title ?? ""}\n${(r.text ?? "").slice(0, 500)}`)
      .join("\n\n");
    // B-12：最新性が問われる断片（volatile）を採用したら、そのことを system 側で伝える。
    //   ⚠️ 本文（<knowledge>）ではなく system に書く。資料の中に注意書きを混ぜると、
    //      それ自体が「資料の内容」として引用されてしまう。
    const volatile = krows.some((r) => r.freshness === "volatile");
    const knowledge = personaBlock ? `${personaBlock}\n\n${body}` : body;
    const sources: BotSource[] = krows.map((r) => ({
      type: "doc",
      docType: r.sourceType,
      title: r.title ?? (r.sourceType === "chat_bookmark" ? "ブックマーク" : "資料"),
      url: r.url,
      excerpt: (r.text ?? "").slice(0, 140),
      score: r.score,
    }));
    // vec / kw の内訳は検索 v2（AI_SEARCH_V2=true）のときだけ入る。旧検索では 0。
    const retrieval: RetrievalTrace[] = krows.map((r) => ({
      src: r.sourceType, id: r.chunkId, title: r.title ?? "",
      vec: r.vec, kw: r.kw, score: r.score, used: true,
    }));
    return { knowledge, sources, styleGuide, retrieval, volatile };
  }
  // ── 以下は切り戻し用（AI_PHASE_A_FALLBACK=true のときだけ通る）──
  const rows = await retrieveContext(message, scopeGenres);
  const knowledge = rows
    .map((r) => `[bm:${r.bookmark_id}][${r.genre}] ${(r.answer_text ?? "").slice(0, 600)}`)
    .join("\n\n");
  const sources: BotSource[] = rows.map((r) => ({
    type: "bookmark", id: r.bookmark_id, genre: r.genre,
    excerpt: (r.answer_text ?? "").slice(0, 140), score: r.score,
  }));
  const retrieval: RetrievalTrace[] = rows.map((r) => ({
    src: "chat_bookmark", id: r.bookmark_id, title: r.genre ?? "",
    vec: 0, kw: 0, score: r.score, used: true,
  }));
  return { knowledge, sources, styleGuide: "", retrieval, volatile: false };
}

// ── 監査ログ ──────────────────────────────────────────────────
export async function logPublic(row: {
  entry: BotEntry;
  subject_key: string;
  question: string;
  matched_bookmark_ids: number[];
  used_web: boolean;
  refused: boolean;
  ok: boolean;
  error?: string | null;
  /** 回答本文（Ph0で追加。クレーム対応で「何と答えたか」を残すため） */
  answer?: string;
  /** 出典（type/id/score）。フェーズB では bookmark_id が空になるため一般化した */
  sources?: BotSource[];
  /** ai_traces.id */
  trace_id?: number | null;
}): Promise<void> {
  try {
    await sb.from("bot_public_logs").insert({
      entry: row.entry,
      subject_key: row.subject_key,
      question: (row.question ?? "").slice(0, 2000),
      matched_bookmark_ids: row.matched_bookmark_ids,
      used_web: row.used_web,
      refused: row.refused,
      ok: row.ok,
      error: row.error ?? null,
      answer: (row.answer ?? "").slice(0, 4000),
      sources: row.sources ?? [],
      trace_id: row.trace_id ?? null,
    });
  } catch {
    /* ログ失敗で本処理は止めない */
  }
}

// ── 索引の再生成（chat_bookmarks → bot_bm_index）───────────────
interface BookmarkRow {
  id: number; genre: string | null;
  expected_question: string | null; keywords: string[] | null;
  formatted_reply: string | null; original_text: string | null;
}

function buildRetrievalText(b: BookmarkRow): string {
  return [b.expected_question ?? "", (b.keywords ?? []).join(" "), b.original_text ?? ""]
    .map((s) => s.trim()).filter(Boolean).join("\n");
}
function buildAnswerText(b: BookmarkRow): string {
  const t = (b.formatted_reply ?? "").trim() || (b.original_text ?? "").trim();
  return t.slice(0, 1200);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface RebuildResult { scanned: number; upserted: number; unchanged: number; pruned: number }

/**
 * ai_enabled=true のブックマークだけを索引化する。content_hash 不変ならスキップ。
 * ⚠️ ★凍結（R4）。フェーズBへ一本化したため通常運転では呼ばない。
 *    /api/bot/index は AI_PHASE_A_FALLBACK=true のときだけ受け付ける。
 */
export async function rebuildBotIndex(): Promise<RebuildResult> {
  const { data } = await sb
    .from("chat_bookmarks")
    .select("id, genre, expected_question, keywords, formatted_reply, original_text")
    .eq("ai_enabled", true)
    .eq("is_deleted", false);

  const rows = (data as BookmarkRow[] | null) ?? [];

  const { data: idxData } = await sb.from("bot_bm_index").select("bookmark_id, content_hash");
  const existing = new Map<number, string>();
  for (const r of (idxData as { bookmark_id: number; content_hash: string }[] | null) ?? []) {
    existing.set(r.bookmark_id, r.content_hash);
  }

  let upserted = 0;
  let unchanged = 0;
  const keep = new Set<number>();

  for (const b of rows) {
    keep.add(b.id);
    const retrieval = buildRetrievalText(b);
    const hash = sha256(`${b.genre ?? ""}${retrieval}`);
    if (existing.get(b.id) === hash) { unchanged++; continue; }

    const emb = await embedText(retrieval);
    await sb.rpc("bot_bm_upsert", {
      p_id: b.id,
      p_genre: b.genre ?? "",
      p_retrieval: retrieval,
      p_answer: buildAnswerText(b),
      p_emb: toVectorLiteral(emb),
      p_hash: hash,
    });
    upserted++;
  }

  // 対象外になった（ai_enabled=false / 論理削除）索引を除去
  let pruned = 0;
  const staleIds = [...existing.keys()].filter((id) => !keep.has(id));
  if (staleIds.length) {
    await sb.from("bot_bm_index").delete().in("bookmark_id", staleIds);
    pruned = staleIds.length;
  }

  return { scanned: rows.length, upserted, unchanged, pruned };
}
