// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// AI 呼び出しの唯一の入口（サーバー専用）
//
//   すべての AI 機能はこの callClaude() / callClaudeEx() を経由する。
//   ・APIキーはサーバー側のみ（クライアントへ絶対に出さない）
//   ・レスポンス整形／エラー変換／ai_logs への監査記録を一元化
//   ・レート制限（メンバー単位）もここで判定する
//   ・タイムアウトと再試行（429 / 5xx / ネットワーク断）をここに閉じ込める
//   ・ai_traces へ「最終プロンプト全文・回答・根拠・コスト」を記録する（Ph0）
//
//   ⚠️ ai_traces は顧客の個人情報を含む。閲覧は管理者のみ・既定90日で物理削除。
//      記録を止めたいときは環境変数 AI_TRACE_ENABLED=false。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../../authz";
import { coreDb } from "../db";
import { loadProjectConfig } from "../config/project";

/** この Core を使っているプロジェクト（Ph3）。 */
const PROJECT_SLUG = process.env.AI_PROJECT_SLUG || "kawai-camp";
// ⚠️ 機能キーは string で受ける。PJ 固有の機能ユニオン（lib/ai/types.ts の AiFeature）を
//    Core が知ってしまうと、新PJのたびに Core を直すことになる。
//    PJ 側の AiFeature（文字列ユニオン）はそのまま渡せる。

// ⚠️ Core は Supabase クライアントを直接持たない。PJ が渡したものを使う（lib/ai-core/db.ts）。
const sb = (): SupabaseClient => coreDb();

interface AnthropicTextBlock { type: string; text?: string }
interface AnthropicUsage { input_tokens?: number; output_tokens?: number }
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  usage?: AnthropicUsage;
  error?: { message?: string };
}

/** マルチモーダルの1ブロック（画像入力を使う機能のみ） */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface AiMessage {
  role: "user" | "assistant";
  /** 文字列（通常）／ブロック配列（画像を含む場合） */
  content: string | ContentBlock[];
}

/** 検索の候補と採点（トレースに残す）。Ph2 で vec / kw の内訳が入る。 */
export interface RetrievalTrace {
  src: string;                 // 'chat_bookmark' | 'note' | 'content' | 'news' | ...
  id: number | string;
  title: string;
  vec: number;
  kw: number;
  score: number;
  used: boolean;               // 閾値を超えて文脈に載せたか
}

export interface CallOpts {
  feature: string;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  model?: string;
  temperature?: number;
  /** 実行者（ai_logs / ai_traces 用）。null 可。 */
  callerMemberId: number | null;

  // ── ここから下は任意。既存の呼び出しはそのまま動く ──
  /** 1リクエスト内の複数呼び出しを束ねるID。未指定なら内部で採番 */
  requestId?: string;
  /** ユーザーの生入力（トレースの検索キーになる） */
  userInput?: string;
  /** 公開ボット用。anon / member / trial */
  entry?: string;
  /** 会員IDが無い場合の主体キー（端末ハッシュ等） */
  subjectKey?: string;
  /** 会話セッション（bot_sessions.id）。ai_traces.session_id に入る（S-5） */
  sessionId?: number | null;
  /** 検索の候補と採点 */
  retrieval?: RetrievalTrace[];
  /** 実際に回答へ使った出典 */
  usedSources?: unknown[];
  /** プロンプトの版（ai_prompts.updated_at をキー化したもの） */
  promptVersion?: string;
  /** 全体の計測開始時刻（Date.now()）。total_ms に使う */
  startedAt?: number;
  /** タイムアウト上書き（ms）。未指定なら用途別の既定値 */
  timeoutMs?: number;
  /** トレースを残さない（プロンプト管理画面の試走など） */
  skipTrace?: boolean;
}

export interface CallResult {
  text: string;
  traceId: number | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  retryCount: number;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
/** 添削など短文タスク用の軽量モデル（未設定なら既定モデル） */
export const LIGHT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT || DEFAULT_MODEL;

/** 入力の最大長（プロンプトインジェクション/コスト対策） */
export const MAX_INPUT_CHARS = 4000;

/** 入力長を検証して切り詰める */
export function clampInput(s: string, max = MAX_INPUT_CHARS): string {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

// ── タイムアウトと再試行 ──────────────────────────────────────
/** 用途別のタイムアウト（ms）。生成は長く、分類など短文タスクは短く。 */
export const TIMEOUT_MS = {
  generate: 60_000,
  light: 15_000,
} as const;

/** 再試行してよい HTTP ステータス（4xx は再試行しても結果が変わらない） */
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
/** 再試行の待ち時間（ms）。長さ＝最大再試行回数 */
const RETRY_DELAYS = [1_000, 3_000];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * タイムアウト付き fetch ＋ 指数バックオフの再試行。
 * 再試行しても成否が変わらないもの（4xx）はそのまま返す。
 */
async function fetchWithRetry(
  url: string, init: RequestInit, timeoutMs: number,
): Promise<{ res: Response; retries: number }> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || !RETRYABLE.has(res.status)) return { res, retries: attempt };
      if (attempt === RETRY_DELAYS.length) return { res, retries: attempt };
      // Retry-After があれば尊重する（上限10秒）
      const ra = Number(res.headers.get("retry-after") ?? 0);
      await sleep(ra > 0 ? Math.min(ra * 1000, 10_000) : (RETRY_DELAYS[attempt] ?? 1_000));
    } catch (e: unknown) {
      lastErr = e;
      if (attempt === RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[attempt] ?? 1_000);
    }
  }
  throw lastErr;
}

// ── レート制限（ai_usage カウンタ）────────────────────────────
const RATE_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 10);
const RATE_PER_DAY = Number(process.env.AI_RATE_LIMIT_PER_DAY ?? 50);

/**
 * 利用回数を加算して上限を判定する。上限超過は HttpError(429)。
 * 戻り値は「本日の残り回数」。
 *
 * ⚠️ 加算してから判定するため、カウンタは上限をわずかに超えうる（bot_usage と同じ方式）。
 *    ゲートとしては正しく働く。
 * ⚠️ 以前は ai_logs の count(*) で判定していた。ログが増えるほど重くなるため分離した。
 */
export async function checkRateLimit(
  memberId: number | null,
  feature: string,
  perDay = RATE_PER_DAY,
): Promise<number> {
  if (memberId == null) return perDay;

  // 分あたり（全機能合算）。上限は ai_project_configs.limits.per_min → 環境変数 → 既定10。
  try {
    const cfg = await loadProjectConfig(PROJECT_SLUG);
    const limitPerMin = cfg.limits.per_min ?? RATE_PER_MIN;
    const { data } = await sb().rpc("ai_usage_minute_bump", { p_member_id: memberId });
    const perMin = typeof data === "number" ? data : 0;
    if (perMin > limitPerMin) {
      throw new HttpError(429, "リクエストが多すぎます。少し時間をおいてお試しください。");
    }
  } catch (e: unknown) {
    if (e instanceof HttpError) throw e;
    // カウンタ側の障害で本処理を止めない（可用性を優先する）
  }

  // 当日・機能別
  const { data } = await sb().rpc("ai_usage_bump", { p_member_id: memberId, p_feature: feature });
  const used = typeof data === "number" ? data : 0;
  if (used > perDay) {
    throw new HttpError(429, `本日の利用上限（${perDay}回）に達しました。`);
  }
  return Math.max(0, perDay - used);
}

// ── 監査ログ ──────────────────────────────────────────────────
async function writeLog(row: {
  feature: string;
  member_id: number | null;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  try {
    await sb().from("ai_logs").insert(row);
  } catch {
    /* ログ失敗で本処理を止めない */
  }
}

/** 採用イベントなど、AI呼び出しを伴わない記録 */
export async function logEvent(
  feature: string,
  memberId: number | null,
  note?: string,
): Promise<void> {
  await writeLog({
    feature, member_id: memberId, model: "-",
    tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: true, error: note ?? null,
  });
}

// ── コスト換算（単価は ai_model_prices。コードに単価を書かない）──
interface PriceRow { model: string; input_jpy_per_1k: number; output_jpy_per_1k: number }
const PRICE_TTL_MS = 60_000;
let priceCache: { at: number; map: Map<string, PriceRow> } | null = null;

async function loadPrices(): Promise<Map<string, PriceRow>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.map;
  const map = new Map<string, PriceRow>();
  try {
    const { data } = await sb().from("ai_model_prices").select("model, input_jpy_per_1k, output_jpy_per_1k");
    for (const r of (data as PriceRow[] | null) ?? []) map.set(r.model, r);
  } catch {
    /* 単価が引けなければ 0 のまま（画面では「単価未設定」と表示する） */
  }
  priceCache = { at: Date.now(), map };
  return map;
}

/** 単価が未設定なら 0 を返す。0 の意味は「未設定」であって「無料」ではない。 */
async function costJpy(model: string, tokensIn: number, tokensOut: number): Promise<number> {
  const p = (await loadPrices()).get(model);
  if (!p) return 0;
  const v = (tokensIn / 1000) * Number(p.input_jpy_per_1k ?? 0)
          + (tokensOut / 1000) * Number(p.output_jpy_per_1k ?? 0);
  return Number.isFinite(v) ? Number(v.toFixed(4)) : 0;
}

// ── トレース ──────────────────────────────────────────────────
const TRACE_ENABLED = process.env.AI_TRACE_ENABLED !== "false";

/** 保存に適さないもの（画像本体など）を落とす。現状は text のみだが将来の block 配列に備える。 */
function maskForTrace(messages: AiMessage[]): unknown[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: m.content.map((b) =>
        b.type === "image"
          // 画像の base64 は保存しない（容量と情報リスク）。大きさだけ残す。
          ? { type: "image", omitted: true, bytes: b.source?.data?.length ?? 0 }
          : b),
    };
  });
}

/** requestId を採番する（外から渡されなかった場合） */
function newRequestId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `req_${Date.now().toString(36)}${rnd}`;
}

interface TraceRow {
  feature: string;
  member_id: number | null;
  subject_key: string;
  entry: string;
  session_id: number | null;
  request_id: string;
  user_input: string;
  system_prompt: string;
  messages_json: unknown[];
  prompt_version: string;
  retrieval_json: unknown[];
  used_sources: unknown[];
  answer: string;
  model: string;
  temperature: number | null;
  max_tokens: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_jpy: number;
  latency_ms: number;
  total_ms: number;
  retry_count: number;
  ok: boolean;
  error: string | null;
}

/** ai_traces へ1行記録する。失敗しても本処理は止めない。 */
async function writeTrace(row: TraceRow): Promise<number | null> {
  if (!TRACE_ENABLED) return null;
  try {
    const { data } = await sb().from("ai_traces").insert(row).select("id").single();
    return (data as { id?: number } | null)?.id ?? null;
  } catch {
    return null;
  }
}

// ── 本体 ──────────────────────────────────────────────────────
/**
 * Anthropic Messages API を呼び、テキストと実行情報を返す。
 * 詳細（traceId・トークン・レイテンシ）が要る呼び出し元はこちらを使う。
 */
export async function callClaudeEx(o: CallOpts): Promise<CallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "ANTHROPIC_API_KEY がサーバーに設定されていません");
  }
  const model = o.model || DEFAULT_MODEL;
  const maxTokens = o.maxTokens ?? 1024;
  const temperature = o.temperature ?? 0.4;
  const requestId = o.requestId ?? newRequestId();
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS.generate;
  const started = Date.now();
  const wallStart = o.startedAt ?? started;

  const baseTrace = {
    feature: o.feature,
    member_id: o.callerMemberId,
    subject_key: o.subjectKey ?? "",
    session_id: o.sessionId ?? null,
    entry: o.entry ?? "",
    request_id: requestId,
    user_input: (o.userInput ?? "").slice(0, 4000),
    system_prompt: o.system,
    messages_json: maskForTrace(o.messages),
    prompt_version: o.promptVersion ?? "",
    retrieval_json: o.retrieval ?? [],
    used_sources: o.usedSources ?? [],
    model,
    temperature,
    max_tokens: maxTokens,
  };

  let res: Response;
  let retries = 0;
  try {
    const r = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: o.system,
        messages: o.messages,
      }),
    }, timeoutMs);
    res = r.res;
    retries = r.retries;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "network error";
    const latency = Date.now() - started;
    await writeLog({
      feature: o.feature, member_id: o.callerMemberId, model,
      tokens_in: 0, tokens_out: 0, latency_ms: latency, ok: false, error: msg,
    });
    if (!o.skipTrace) {
      await writeTrace({
        ...baseTrace, answer: "", tokens_in: 0, tokens_out: 0, cost_jpy: 0,
        latency_ms: latency, total_ms: Date.now() - wallStart,
        retry_count: RETRY_DELAYS.length, ok: false, error: msg,
      });
    }
    throw new HttpError(502, "AIサービスに接続できませんでした");
  }

  const json = (await res.json()) as AnthropicResponse;
  const latency = Date.now() - started;

  if (!res.ok) {
    const msg = json?.error?.message ?? `AI呼び出しに失敗しました (${res.status})`;
    await writeLog({
      feature: o.feature, member_id: o.callerMemberId, model,
      tokens_in: 0, tokens_out: 0, latency_ms: latency, ok: false, error: msg,
    });
    if (!o.skipTrace) {
      await writeTrace({
        ...baseTrace, answer: "", tokens_in: 0, tokens_out: 0, cost_jpy: 0,
        latency_ms: latency, total_ms: Date.now() - wallStart,
        retry_count: retries, ok: false, error: msg,
      });
    }
    throw new HttpError(502, msg);
  }

  const text = (json.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();

  const tokensIn = json.usage?.input_tokens ?? 0;
  const tokensOut = json.usage?.output_tokens ?? 0;

  await writeLog({
    feature: o.feature, member_id: o.callerMemberId, model,
    tokens_in: tokensIn, tokens_out: tokensOut,
    latency_ms: latency, ok: true, error: null,
  });

  let traceId: number | null = null;
  if (!o.skipTrace) {
    traceId = await writeTrace({
      ...baseTrace,
      answer: text,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_jpy: await costJpy(model, tokensIn, tokensOut),
      latency_ms: latency,
      total_ms: Date.now() - wallStart,
      retry_count: retries,
      ok: true,
      error: null,
    });
  }

  return { text, traceId, tokensIn, tokensOut, latencyMs: latency, retryCount: retries };
}

// ── ストリーミング（B-3）────────────────────────────────────
//
//   ★ 非ストリーミングの callClaudeEx() と「ゲートの中身」を必ず同じにする。
//     ログ・トレース・コスト換算・レート制限はすべて同じ関数を通す。
//     ここだけ別実装にすると、片方だけ記録が漏れる状態が生まれる。
//
//   ⚠️ 再試行はトークンを1文字も出す前だけ。
//     出し始めたあとに失敗しても、やり直すと利用者には途中まで出た文が二重に見える。
//     途中で切れた場合は、そこまでの内容で確定して記録する（ok=false）。
//
//   ⚠️ 呼び出し側は必ず finally で締めること。Vercel の関数は
//     ストリームを閉じ忘れると上限まで生き続ける。

interface SseUsage { input_tokens?: number; output_tokens?: number }
interface SseEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: { usage?: SseUsage };
  usage?: SseUsage;
  error?: { message?: string };
}

/**
 * Anthropic Messages API をストリームで呼ぶ。
 * 生成されたテキストは onDelta で少しずつ渡し、終わったら callClaudeEx と同じ CallResult を返す。
 */
export async function callClaudeStream(
  o: CallOpts, onDelta: (text: string) => void,
): Promise<CallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "ANTHROPIC_API_KEY がサーバーに設定されていません");
  }
  const model = o.model || DEFAULT_MODEL;
  const maxTokens = o.maxTokens ?? 1024;
  const temperature = o.temperature ?? 0.4;
  const requestId = o.requestId ?? newRequestId();
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS.generate;
  const started = Date.now();
  const wallStart = o.startedAt ?? started;

  const baseTrace = {
    feature: o.feature,
    member_id: o.callerMemberId,
    subject_key: o.subjectKey ?? "",
    session_id: o.sessionId ?? null,
    entry: o.entry ?? "",
    request_id: requestId,
    user_input: (o.userInput ?? "").slice(0, 4000),
    system_prompt: o.system,
    messages_json: maskForTrace(o.messages),
    prompt_version: o.promptVersion ?? "",
    retrieval_json: o.retrieval ?? [],
    used_sources: o.usedSources ?? [],
    model,
    temperature,
    max_tokens: maxTokens,
  };

  /** 失敗を記録して throw する（接続前・応答前だけで使う） */
  const failBefore = async (msg: string, retries: number, status: number): Promise<never> => {
    const latency = Date.now() - started;
    await writeLog({
      feature: o.feature, member_id: o.callerMemberId, model,
      tokens_in: 0, tokens_out: 0, latency_ms: latency, ok: false, error: msg,
    });
    if (!o.skipTrace) {
      await writeTrace({
        ...baseTrace, answer: "", tokens_in: 0, tokens_out: 0, cost_jpy: 0,
        latency_ms: latency, total_ms: Date.now() - wallStart,
        retry_count: retries, ok: false, error: msg,
      });
    }
    throw new HttpError(status, msg);
  };

  // ── 接続（ここまでは再試行してよい。まだ1文字も出していない）──
  let res: Response;
  let retries = 0;
  try {
    const r = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        system: o.system, messages: o.messages,
        stream: true,
      }),
    }, timeoutMs);
    res = r.res;
    retries = r.retries;
  } catch (e: unknown) {
    return failBefore(
      e instanceof Error ? e.message : "network error", RETRY_DELAYS.length, 502);
  }

  if (!res.ok || !res.body) {
    let msg = "AI呼び出しに失敗しました (" + res.status + ")";
    try {
      const j = (await res.json()) as AnthropicResponse;
      msg = j?.error?.message ?? msg;
    } catch { /* 本文が読めないこともある */ }
    return failBefore(msg, retries, 502);
  }

  // ── ここから先は再試行しない（出した文字は取り消せない）──
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let streamError: string | null = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handle = (payload: string): void => {
    if (!payload || payload === "[DONE]") return;
    let ev: SseEvent;
    try { ev = JSON.parse(payload) as SseEvent; } catch { return; }

    if (ev.type === "error") {
      streamError = ev.error?.message ?? "ストリームが中断されました";
      return;
    }
    if (ev.type === "message_start") {
      tokensIn = ev.message?.usage?.input_tokens ?? 0;
      return;
    }
    if (ev.type === "message_delta") {
      tokensOut = ev.usage?.output_tokens ?? tokensOut;
      return;
    }
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      const t = ev.delta.text ?? "";
      if (t) { text += t; onDelta(t); }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE はイベントを空行で区切る
      let sep = buf.indexOf("\n\n");
      while (sep >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) handle(line.slice(5).trim());
        }
        sep = buf.indexOf("\n\n");
      }
    }
  } catch (e: unknown) {
    // 途中で切れた。ここまでの内容で確定させる（やり直さない）
    streamError = e instanceof Error ? e.message : "ストリームが中断されました";
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  const latency = Date.now() - started;
  const ok = streamError === null;
  const finalText = text.trim();

  await writeLog({
    feature: o.feature, member_id: o.callerMemberId, model,
    tokens_in: tokensIn, tokens_out: tokensOut,
    latency_ms: latency, ok, error: streamError,
  });

  let traceId: number | null = null;
  if (!o.skipTrace) {
    traceId = await writeTrace({
      ...baseTrace,
      answer: finalText,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_jpy: await costJpy(model, tokensIn, tokensOut),
      latency_ms: latency,
      total_ms: Date.now() - wallStart,
      retry_count: retries,
      ok,
      error: streamError,
    });
  }

  return {
    text: finalText, traceId, tokensIn, tokensOut,
    latencyMs: latency, retryCount: retries,
  };
}

/**
 * Anthropic Messages API を呼び、テキストを返す。
 * 既存の呼び出し元はこの形のまま使える（戻り値は文字列）。
 */
export async function callClaude(o: CallOpts): Promise<string> {
  const r = await callClaudeEx(o);
  return r.text;
}

// ── JSON 出力のパース ─────────────────────────────────────────
/**
 * モデルの出力から JSON を取り出す。
 * ```json フェンスや前置き文が混じっても復旧できるようにする。
 * 想定外の構造なら null。
 */
export function parseJson<T>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();

  // ```json ... ``` を剥がす
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();

  // 最初の { 〜 最後の } を切り出す
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  s = s.slice(first, last + 1);

  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** JSON パースに失敗したら 502 にする（呼び出し側の分岐を減らす） */
export function parseJsonOrThrow<T>(raw: string): T {
  const v = parseJson<T>(raw);
  if (v == null) throw new HttpError(502, "AIの応答を解釈できませんでした。もう一度お試しください。");
  return v;
}

/** 本文から [要確認: 〜] を抽出 */
export function extractNeedsInput(text: string): string[] {
  const found = text.match(/\[要確認:\s*([^\]]+)\]/g) ?? [];
  return Array.from(new Set(found.map((s) => s.replace(/^\[要確認:\s*/, "").replace(/\]$/, "").trim())));
}
