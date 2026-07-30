// ============================================================
// 埋め込み生成（サーバー専用）
//   OpenAI text-embedding-3-small（1536次元）を fetch で呼ぶ。
//   ※ 既存 lib/ai/claude.ts と同じく、依存を増やさず fetch で実装する。
//   APIキー(OPENAI_API_KEY)はサーバー側のみ。クライアントへ絶対に出さない。
// ============================================================
import { HttpError } from "../authz";

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

/** 埋め込みの入力最大長（コスト・トークン対策） */
const MAX_EMBED_CHARS = 8000;

interface OpenAiEmbedResponse {
  data?: { embedding?: number[] }[];
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

/** number[] を pgvector のテキストリテラル（"[0.1,0.2,...]"）にする。 */
export function toVectorLiteral(v: number[]): string {
  return v.length ? `[${v.join(",")}]` : "";
}
