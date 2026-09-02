// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// OpenAI テキスト生成の唯一の入口（サーバー専用）
//
//   なぜ Claude とは別にこれが要るのか：
//     画像生成は OpenAI のモデル（gpt-image-*）を使っている。
//     その画像モデルへ渡す指示を書き直す（＝翻訳する）役は、
//     **同じベンダーの言語モデルのほうが、その画像モデルに効く
//     言い回しを知っている**と考えられる。ChatGPT が同じことを
//     しているのと同じ組み合わせに揃える、という判断。
//     （2026-09-02 決定。設計書 v6 §7-4）
//
//   ⚠️ これで「チャット系プロバイダが2つ」になった。増やすときは必ず
//      ここを読むこと。テキスト生成の既定は今も Claude（llm.ts）であり、
//      こちらは「画像に付随する短文タスク」のための口である。
//      汎用のテキスト生成をこちらへ寄せないこと。
//
//   callClaudeEx() と同じ規律をここでも守る：
//     ・APIキーはサーバー側のみ（クライアントへ絶対に出さない）
//     ・タイムアウトと再試行（llm.ts の fetchWithRetry を共用する）
//     ・ai_traces へ1行記録する（コスト・レイテンシを後から追える）
//     ・外部の生エラー文をそのまま利用者へ出さない
//   ⚠️ 単価はコードに書かない。ai_model_prices を引く（tokenCostJpy）。
// ============================================================
import { HttpError } from "../../authz";
import { fetchWithRetry, newRequestId, tokenCostJpy, writeTrace } from "./llm";

/**
 * 既定モデル。安い・速い・短文の書き直しには十分、という前提で選ぶ。
 * ⚠️ モデル名を上げ下げしたら ai_model_prices に同名の行を入れること。
 *    行が無いと cost_jpy が 0 になる（「無料」ではなく「未設定」）。
 */
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.6-luna";

/** 短文タスク用。生成より短く取る。 */
const CHAT_TIMEOUT_MS = Number(process.env.AI_OPENAI_CHAT_TIMEOUT_MS ?? 60_000);

/** 入力の上限（コスト・注入対策）。画像の美術指定を通すので長めに取る。 */
const MAX_CHAT_INPUT = Number(process.env.AI_OPENAI_CHAT_INPUT_MAX ?? 30_000);

/**
 * 推論の深さ。既定は「送らない」。
 * ⚠️ 未検証のパラメータを既定で送ると、モデル側が受け付けなかったときに
 *    400 で全部落ちる。実機で通ることを確認してから環境変数で入れること。
 *    "none" にすると推論トークンを使わないぶん安く速くなる。
 */
const REASONING_EFFORT = process.env.OPENAI_CHAT_REASONING_EFFORT || "";

/** llm.ts の RETRY_DELAYS と同じ本数。接続失敗時のトレースに入れる */
const MAX_RETRIES = 2;

export interface OpenAiChatOpts {
  /** ai_logs.feature と同じキー。機能キーは増やさない */
  feature: string;
  /** 役割の指示（Anthropic の system にあたる） */
  system?: string;
  /** 利用者ぶんの入力 */
  user: string;
  model?: string;
  maxTokens?: number;
  callerMemberId: number | null;
  entry?: string;
  subjectKey?: string;
  sessionId?: number | null;
  requestId?: string;
  timeoutMs?: number;
  /** トレースに残す「利用者が入れたもの」。長いものは呼び出し側で刈る */
  userInput?: string;
}

export interface OpenAiChatRes {
  text: string;
  traceId: number | null;
  tokensIn: number;
  tokensOut: number;
  costJpy: number;
  latencyMs: number;
  /** 推論に使われたトークン。枠の取り方を見直すときの材料 */
  reasoningTokens: number;
}

// ── Responses API のかたち ────────────────────────────────────
//   ⚠️ output は配列で、推論モデルは先頭に reasoning の項目を置く。
//      output[0] を決め打ちで読むと、推論の空文字を答えとして拾う。
//      必ず type==="message" を探して、その中の output_text を集める。
interface ResponsesContent { type?: string; text?: string }
interface ResponsesItem { type?: string; content?: ResponsesContent[] }
interface ResponsesBody {
  status?: string;
  output_text?: string;
  output?: ResponsesItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** 推論に使われたトークン。枠を食い潰したかどうかの判定に要る */
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
  incomplete_details?: { reason?: string };
}

/** output[] から本文だけを取り出す。推論の項目は読み飛ばす。 */
function extractText(json: ResponsesBody): string {
  // SDK 互換の近道。素の API には無いことがあるので、無ければ下で組み立てる。
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text;
  }
  const parts: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

/**
 * OpenAI の言語モデルを1回呼び、テキストと実行情報を返す。
 *
 * ⚠️ 失敗は例外で返す。呼び出し側は「落ちても本処理を続ける」かどうかを
 *    自分で決めること（画像の書き直しは、落ちたら生の指示で続行する）。
 */
export async function callOpenAiChat(o: OpenAiChatOpts): Promise<OpenAiChatRes> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "OPENAI_API_KEY がサーバーに設定されていません");
  }

  const model = o.model || CHAT_MODEL;
  const rawInput = (o.user ?? "").trim();
  const input = rawInput.slice(0, MAX_CHAT_INPUT);
  if (!input) throw new HttpError(400, "指示が空です");
  // ⚠️ 黙って切らない（image.ts で同じ罠を踏んだ）。
  if (rawInput.length > input.length) {
    console.warn(
      `callOpenAiChat: 入力を切り詰めました ${rawInput.length} → ${input.length} 文字`
      + `（feature=${o.feature}）`,
    );
  }

  const maxTokens = Math.min(Math.max(Number(o.maxTokens ?? 4000), 200), 32_000);
  const requestId = o.requestId ?? newRequestId();
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    model,
    input,
    max_output_tokens: maxTokens,
  };
  if (o.system) body.instructions = o.system;
  if (REASONING_EFFORT) body.reasoning = { effort: REASONING_EFFORT };

  let res: Response;
  let retries = 0;
  try {
    const r = await fetchWithRetry(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      o.timeoutMs ?? CHAT_TIMEOUT_MS,
    );
    res = r.res;
    retries = r.retries;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AIサービスに接続できませんでした";
    // ⚠️ ここへ来たときは fetchWithRetry が再試行を出し切っている。
    //    retries は解決時にしか代入されないので、0 ではなく上限を記録する。
    await trace(o, model, requestId, "", 0, 0, 0,
      Date.now() - startedAt, MAX_RETRIES, false, msg, input);
    throw new HttpError(502, msg);
  }

  const json = (await res.json().catch(() => ({}))) as ResponsesBody;
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const msg = json.error?.message ?? `AIの呼び出しに失敗しました（${res.status}）`;
    await trace(o, model, requestId, "", 0, 0, 0, latencyMs, retries, false, msg, input);
    // ⚠️ 外部のエラー文をそのまま利用者へ出さない。呼び出し側で定型文に畳む。
    throw new HttpError(res.status === 429 ? 429 : 502, msg);
  }

  const text = extractText(json);
  const tokensIn = Number(json.usage?.input_tokens ?? 0);
  const tokensOut = Number(json.usage?.output_tokens ?? 0);
  const reasoningTokens = Number(json.usage?.output_tokens_details?.reasoning_tokens ?? 0);
  const cost = await tokenCostJpy(model, tokensIn, tokensOut);

  /**
   * ⚠️ **途中で切れた本文を成功として返さないこと。**
   *    推論モデルは推論ぶんも max_output_tokens を食う。枠が尽きると
   *    HTTP 200 のまま status="incomplete" で「途中まで」が返る。
   *    これを通すと、書き直しの後半が落ちた指示が画像APIへ行く
   *    ——**この層を作った動機そのものの事故**（指定が消える）が、
   *    しかも成功扱いで再発する。呼び出し側は失敗として扱い、
   *    元の指示へフォールバックできなければならない。
   */
  const incomplete = json.status === "incomplete" || !!json.incomplete_details?.reason;
  if (incomplete || !text.trim()) {
    const why = json.incomplete_details?.reason ?? json.status ?? "unknown";
    const msg = text.trim()
      ? `AIの出力が途中で切れました（${why}／推論 ${reasoningTokens} トークン）`
      : `AIから本文を受け取れませんでした（${why}／推論 ${reasoningTokens} トークン）`;
    await trace(o, model, requestId, text, tokensIn, tokensOut, cost,
      latencyMs, retries, false, msg, input);
    throw new HttpError(502, msg);
  }

  const traceId = await trace(
    o, model, requestId, text, tokensIn, tokensOut, cost, latencyMs, retries, true, null, input,
  );
  return { text, traceId, tokensIn, tokensOut, costJpy: cost, latencyMs, reasoningTokens };
}

/** ai_traces へ1行残す。失敗しても本処理は止めない（writeTrace 側で握る）。 */
async function trace(
  o: OpenAiChatOpts, model: string, requestId: string, answer: string,
  tokensIn: number, tokensOut: number, cost: number,
  latencyMs: number, retries: number, ok: boolean, error: string | null,
  sent = "",
): Promise<number | null> {
  return writeTrace({
    feature: o.feature,
    member_id: o.callerMemberId,
    subject_key: o.subjectKey ?? "",
    entry: o.entry ?? "",
    session_id: o.sessionId ?? null,
    request_id: requestId,
    user_input: (o.userInput ?? "").slice(0, 4000),
    system_prompt: o.system ?? "",
    // ⚠️ 実際に送ったもの（切り詰め後）を残す。送っていない文を記録しない。
    messages_json: [{ role: "user", content: sent.slice(0, 4000) }],
    prompt_version: "",
    retrieval_json: [],
    used_sources: [],
    answer,
    model,
    temperature: null,
    max_tokens: o.maxTokens ?? null,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_jpy: cost,
    latency_ms: latencyMs,
    total_ms: latencyMs,
    retry_count: retries,
    ok,
    error,
  });
}
