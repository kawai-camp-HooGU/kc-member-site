// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// 埋め込み生成（サーバー専用）
//   OpenAI text-embedding-3-small（1536次元）を fetch で呼ぶ。
//   ※ 既存 lib/ai/claude.ts と同じく、依存を増やさず fetch で実装する。
//   APIキー(OPENAI_API_KEY)はサーバー側のみ。クライアントへ絶対に出さない。
// ============================================================
import { HttpError } from "../../authz";

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

/** 埋め込みの入力最大長（コスト・トークン対策） */
const MAX_EMBED_CHARS = 8000;

interface OpenAiEmbedResponse {
  data?: { embedding?: number[]; index?: number }[];
  error?: { message?: string };
}

/** テキストを1536次元ベクトルへ変換する。 */
export async function embedText(input: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "OPENAI_API_KEY がサーバーに設定されていません");
  }
  const text = (input ?? "").trim().slice(0, MAX_EMBED_CHARS);
  if (!text) return [];

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message : "埋め込みサービスに接続できませんでした");
  }

  const json = (await res.json()) as OpenAiEmbedResponse;
  if (!res.ok) {
    throw new HttpError(502, json?.error?.message ?? `埋め込み取得に失敗しました (${res.status})`);
  }
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new HttpError(502, "埋め込みの取得に失敗しました");
  }
  return vec;
}

/**
 * 複数テキストをまとめて埋め込む（1リクエスト100件まで）。
 *   ・初回の一括取り込みで chunk ごとに1リクエスト投げると Vercel の実行時間上限に当たるため、
 *     取り込み側はこちらを使う。
 *   ・空文字の位置には [] を返し、入力と同じ長さ・同じ並びの配列を返す。
 */
const EMBED_BATCH = 100;

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "OPENAI_API_KEY がサーバーに設定されていません");
  }
  const out: number[][] = inputs.map(() => []);

  // 空文字は API に送らない（400 になる）。送る対象の位置だけ覚えておく。
  const targets: { idx: number; text: string }[] = [];
  inputs.forEach((raw, idx) => {
    const text = (raw ?? "").trim().slice(0, MAX_EMBED_CHARS);
    if (text) targets.push({ idx, text });
  });

  for (let i = 0; i < targets.length; i += EMBED_BATCH) {
    const batch = targets.slice(i, i + EMBED_BATCH);
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: batch.map((b) => b.text) }),
      });
    } catch (e) {
      throw new HttpError(502, e instanceof Error ? e.message : "埋め込みサービスに接続できませんでした");
    }
    const json = (await res.json()) as OpenAiEmbedResponse;
    if (!res.ok) {
      throw new HttpError(502, json?.error?.message ?? `埋め込み取得に失敗しました (${res.status})`);
    }
    const data = json.data ?? [];
    if (data.length !== batch.length) {
      throw new HttpError(502, "埋め込みの件数が入力と一致しませんでした");
    }
    // OpenAI は index を返すが、並び順は保証されている前提にしない。
    data.forEach((d, k) => {
      const at = typeof d.index === "number" ? d.index : k;
      const slot = batch[at];
      if (slot && Array.isArray(d.embedding)) out[slot.idx] = d.embedding;
    });
  }
  return out;
}

/** number[] を pgvector のテキストリテラル（"[0.1,0.2,...]"）にする。 */
export function toVectorLiteral(v: number[]): string {
  return v.length ? `[${v.join(",")}]` : "";
}
