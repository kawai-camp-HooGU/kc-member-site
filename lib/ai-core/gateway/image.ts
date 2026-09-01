// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// 画像生成の唯一の入口（サーバー専用）
//
//   ⚠️ Claude は画像を「読む」ことはできても「生成」はできない（2026-09 時点）。
//      そのためここだけ別プロバイダ（OpenAI Images）を叩く。
//      キーは埋め込みと同じ OPENAI_API_KEY を使う（キーの追加は不要）。
//
//   callClaude() と同じ規律をここでも守る：
//     ・APIキーはサーバー側のみ（クライアントへ絶対に出さない）
//     ・タイムアウトと再試行をここに閉じ込める
//     ・ai_traces へ1行記録する（コスト・レイテンシを後から追える）
//   ⚠️ 単価はコードに書かない。ai_model_prices.image_jpy_per_unit を引く。
//   ⚠️ 画像本体（base64）はトレースに保存しない。行が巨大になり、
//      ai_traces は管理者が閲覧するテーブルであるため。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../../authz";
import { coreDb } from "../db";
import { imageCostJpy } from "./llm";

const sb = (): SupabaseClient => coreDb();

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
/** 生成は数十秒かかる。LLM より長く待つ。 */
const IMAGE_TIMEOUT_MS = Number(process.env.AI_IMAGE_TIMEOUT_MS ?? 120_000);
/** 画像プロンプトの上限（コスト・注入対策） */
const MAX_IMAGE_PROMPT = 1200;

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "low" | "medium" | "high";

export interface ImageCallOpts {
  /** ai_logs.feature と同じキー。機能キーは増やさない（trial_generate 等を渡す） */
  feature: string;
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  callerMemberId: number | null;
  entry?: string;
  subjectKey?: string;
  sessionId?: number | null;
  requestId?: string;
  timeoutMs?: number;
}

export interface ImageCallRes {
  /** base64 の画像データ。呼び出し側が Storage へ載せる（ここではファイルを持たない） */
  b64: string;
  mime: string;
  traceId: number | null;
  costJpy: number;
  latencyMs: number;
}

interface OpenAiImageResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string };
}

const TRACE_ENABLED = process.env.AI_TRACE_ENABLED !== "false";

/** 画質を単価表の行キーへ写す（品質ごとに単価が違うため） */
function priceKey(quality: ImageQuality): string {
  return `${IMAGE_MODEL}:${quality}`;
}

/**
 * 画像を1枚生成する。
 *
 * ⚠️ prompt には利用者の生入力をそのまま入れないこと。
 *    呼び出し側で「画像生成用の描写文」を一度LLMに作らせてから渡す
 *    （利用者の文章がそのまま外部へ出る経路を作らない）。
 */
export async function callImage(o: ImageCallOpts): Promise<ImageCallRes> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "OPENAI_API_KEY がサーバーに設定されていません");
  }
  const prompt = (o.prompt ?? "").trim().slice(0, MAX_IMAGE_PROMPT);
  if (!prompt) throw new HttpError(400, "画像の内容が空です");

  const quality: ImageQuality = o.quality ?? "low";
  const size: ImageSize = o.size ?? "1024x1024";
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality, n: 1 }),
      signal: AbortSignal.timeout(o.timeoutMs ?? IMAGE_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "画像生成サービスに接続できませんでした";
    await writeImageTrace(o, prompt, quality, "", 0, Date.now() - startedAt, false, msg);
    throw new HttpError(502, msg);
  }

  const json = (await res.json().catch(() => ({}))) as OpenAiImageResponse;
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const msg = json.error?.message ?? `画像生成に失敗しました（${res.status}）`;
    await writeImageTrace(o, prompt, quality, "", 0, latencyMs, false, msg);
    // ⚠️ 外部のエラー文をそのまま利用者へ出さない。呼び出し側で定型文に畳む。
    throw new HttpError(res.status === 429 ? 429 : 502, msg);
  }

  const b64 = json.data?.[0]?.b64_json ?? "";
  if (!b64) {
    const msg = "画像を受け取れませんでした";
    await writeImageTrace(o, prompt, quality, "", 0, latencyMs, false, msg);
    throw new HttpError(502, msg);
  }

  const cost = await imageCostJpy(priceKey(quality), 1);
  const traceId = await writeImageTrace(o, prompt, quality, `image/${size}`, cost, latencyMs, true, null);

  return { b64, mime: "image/png", traceId, costJpy: cost, latencyMs };
}

/**
 * ai_traces へ1行残す。失敗しても本処理は止めない。
 * ⚠️ answer に画像本体を入れない（サイズと閲覧性の両方が壊れる）。
 */
async function writeImageTrace(
  o: ImageCallOpts, prompt: string, quality: ImageQuality,
  answerNote: string, cost: number, latencyMs: number, ok: boolean, error: string | null,
): Promise<number | null> {
  if (!TRACE_ENABLED) return null;
  try {
    const { data } = await sb().from("ai_traces").insert({
      feature: o.feature,
      member_id: o.callerMemberId,
      subject_key: o.subjectKey ?? "",
      entry: o.entry ?? "",
      session_id: o.sessionId ?? null,
      request_id: o.requestId ?? `img_${Date.now().toString(36)}`,
      user_input: prompt.slice(0, 500),
      system_prompt: "",
      messages_json: [],
      prompt_version: "",
      retrieval_json: [],
      used_sources: [],
      answer: answerNote,          // 画像本体は入れない
      model: priceKey(quality),
      temperature: null,
      max_tokens: null,
      tokens_in: 0,
      tokens_out: 0,
      cost_jpy: cost,
      latency_ms: latencyMs,
      total_ms: latencyMs,
      retry_count: 0,
      ok,
      error,
    }).select("id").single();
    return (data as { id?: number } | null)?.id ?? null;
  } catch {
    return null;
  }
}
