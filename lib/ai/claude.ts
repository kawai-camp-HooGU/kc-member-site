// ============================================================
// AI 呼び出しの唯一の入口（サーバー専用）
//
//   すべての AI 機能はこの callClaude() を経由する。
//   ・APIキーはサーバー側のみ（クライアントへ絶対に出さない）
//   ・レスポンス整形／エラー変換／ai_logs への監査記録を一元化
//   ・レート制限（メンバー単位）もここで判定する
//
//   ※ app/api/chat/summarize/route.ts の実装をここへ集約したもの。
// ============================================================
import { supabaseAdmin } from "../supabaseAdmin";
import { HttpError } from "../authz";
import type { AiFeature } from "./types";

interface AnthropicTextBlock { type: string; text?: string }
interface AnthropicUsage { input_tokens?: number; output_tokens?: number }
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  usage?: AnthropicUsage;
  error?: { message?: string };
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallOpts {
  feature: AiFeature;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  model?: string;
  temperature?: number;
  /** 実行者（ai_logs 用）。null 可。 */
  callerMemberId: number | null;
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

// ── レート制限 ────────────────────────────────────────────────
const RATE_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 10);
const RATE_PER_DAY = Number(process.env.AI_RATE_LIMIT_PER_DAY ?? 50);

/**
 * ai_logs のカウントでレート制限を判定する。
 * 上限に達していれば HttpError(429) を throw。
 * 戻り値は「本日の残り回数」。
 */
export async function checkRateLimit(
  memberId: number | null,
  feature: AiFeature,
  perDay = RATE_PER_DAY,
): Promise<number> {
  if (memberId == null) return perDay;

  const now = Date.now();
  const minAgo = new Date(now - 60_000).toISOString();
  const dayStart = new Date(now - 24 * 60 * 60_000).toISOString();

  const { count: perMinCount } = await supabaseAdmin
    .from("ai_logs")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .gte("created_at", minAgo);

  if ((perMinCount ?? 0) >= RATE_PER_MIN) {
    throw new HttpError(429, "リクエストが多すぎます。少し時間をおいてお試しください。");
  }

  const { count: perDayCount } = await supabaseAdmin
    .from("ai_logs")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .eq("feature", feature)
    .gte("created_at", dayStart);

  const used = perDayCount ?? 0;
  if (used >= perDay) {
    throw new HttpError(429, `本日の利用上限（${perDay}回）に達しました。`);
  }
  return Math.max(0, perDay - used - 1);
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
    await supabaseAdmin.from("ai_logs").insert(row);
  } catch {
    /* ログ失敗で本処理を止めない */
  }
}

/** 採用イベントなど、AI呼び出しを伴わない記録 */
export async function logEvent(
  feature: AiFeature,
  memberId: number | null,
  note?: string,
): Promise<void> {
  await writeLog({
    feature, member_id: memberId, model: "-",
    tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: true, error: note ?? null,
  });
}

// ── 本体 ──────────────────────────────────────────────────────
/** Anthropic Messages API を呼び、テキストを返す。 */
export async function callClaude(o: CallOpts): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "ANTHROPIC_API_KEY がサーバーに設定されていません");
  }
  const model = o.model || DEFAULT_MODEL;
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: o.maxTokens ?? 1024,
        temperature: o.temperature ?? 0.4,
        system: o.system,
        messages: o.messages,
      }),
    });
  } catch (e) {
    await writeLog({
      feature: o.feature, member_id: o.callerMemberId, model,
      tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - started,
      ok: false, error: e instanceof Error ? e.message : "network error",
    });
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
    throw new HttpError(502, msg);
  }

  const text = (json.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();

  await writeLog({
    feature: o.feature, member_id: o.callerMemberId, model,
    tokens_in: json.usage?.input_tokens ?? 0,
    tokens_out: json.usage?.output_tokens ?? 0,
    latency_ms: latency, ok: true, error: null,
  });

  return text;
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
  if (fence) s = fence[1].trim();

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
