// ============================================================
// 公開ボット向けナレッジ検索（service_role 専用・フェーズB / 正本 §12）
//   ・published/public の knowledge_chunks をハイブリッド検索。
//   ・埋め込みは OpenAI。ランキングは SQL 関数 knowledge_public_search 側。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../supabaseAdmin";
import { HttpError } from "../../authz";
import { embedText, toVectorLiteral } from "../../bot/embed";

const sb = supabaseAdmin as unknown as SupabaseClient;

export interface KnowledgeRow {
  chunkId: number;
  documentId: number;
  sourceType: string;   // note / x / chat_bookmark
  title: string | null;
  url: string | null;
  text: string;
  score: number;
}

interface RpcRow {
  chunk_id: number; document_id: number; source_type: string;
  title: string | null; canonical_url: string | null; chunk_text: string; score: number;
}

/** published/public の chunk をハイブリッド検索して上位 k 件を返す。 */
export async function retrieveKnowledge(message: string, k = 8): Promise<KnowledgeRow[]> {
  const emb = await embedText(message);
  const { data, error } = await sb.rpc("knowledge_public_search", {
    q: message.slice(0, 500),
    q_emb: toVectorLiteral(emb),
    k,
  });
  if (error) throw new HttpError(502, "ナレッジ検索に失敗しました");
  const rows = (data as RpcRow[] | null) ?? [];
  return rows
    .filter((r) => (r.score ?? 0) > 0)
    .map((r) => ({
      chunkId: r.chunk_id, documentId: r.document_id, sourceType: r.source_type,
      title: r.title, url: r.canonical_url, text: r.chunk_text, score: r.score,
    }));
}
