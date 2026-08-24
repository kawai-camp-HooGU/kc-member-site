// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// ナレッジ検索（service_role 専用）
//   ・旧: knowledge_public_search（published/public のみ・ts_rank）
//   ・新: knowledge_search_v2（persona分離・pgroonga・スコア正規化・属性フィルタ・内訳返却）
//
//   切替は環境変数 AI_SEARCH_V2 で行う（既定は旧のまま）。
//     AI_SEARCH_V2=true  … v2 を使う
//     未設定 / false     … 旧 knowledge_public_search を使う（切り戻し先）
//
//   ★ 属性フィルタ（memberAttrIds）は情報漏えい防止の要。
//     ・呼び出し側は「祖先を展開済み」の属性IDを渡すこと。
//       ★展開は PJ 側の責務（属性ツリーは PJ のテーブル）。lib/ai/knowledge/retrieveServer.ts。
//       SQL 側では再帰しない。展開の実装は canView() と揃えるためアプリ側に一本化する。
//     ・null を渡すと visibility='member' の文書は一切返らない（公開ボット用）。
//     ・本番で会員向けに使う前に /api/bot/knowledge/verify で canView() との同値性を確認すること。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../../authz";
import { coreDb } from "../db";
import { embedText, toVectorLiteral } from "../gateway/embed";
import { loadProjectConfig } from "../config/project";

/** この Core を使っているプロジェクト。PJ側から差し替えられるようにしておく。 */
const PROJECT_SLUG = process.env.AI_PROJECT_SLUG || "kawai-camp";

// ⚠️ Core は Supabase クライアントを直接持たない（lib/ai-core/db.ts）。
const sb = (): SupabaseClient => coreDb();

/** v2 検索を使うか */
export const useSearchV2 = (): boolean => process.env.AI_SEARCH_V2 === "true";

// 閾値・候補数・top_k は ai_project_configs.retrieval から引く（Ph3）。
// 未適用なら環境変数、それも無ければコード既定（lib/ai-core/config/project.ts）。

export interface KnowledgeRow {
  chunkId: number;
  documentId: number;
  sourceType: string;   // note / x / chat_bookmark / content / news
  title: string | null;
  url: string | null;
  text: string;
  score: number;
  /** ベクトル類似（0〜1に正規化済み）。旧検索では 0。 */
  vec: number;
  /** キーワード一致（0〜1に正規化済み）。旧検索では 0。 */
  kw: number;
  /** stable / periodic / volatile。旧検索・未判定は null（B-12） */
  freshness: string | null;
}

export interface RetrieveOptions {
  /** 祖先を展開済みのメンバー属性ID。null＝会員限定文書を出さない（公開ボット） */
  memberAttrIds?: number[] | null;
  /** 取り込み元の絞り込み（例: ["content","news"]）。null＝すべて */
  sourceTypes?: string[] | null;
  threshold?: number;
}

interface RpcRowV1 {
  chunk_id: number; document_id: number; source_type: string;
  title: string | null; canonical_url: string | null; chunk_text: string; score: number;
}
interface RpcRowV2 extends RpcRowV1 {
  vec_score: number; kw_score: number; freshness: string | null;
}

// ── persona ──────────────────────────────────────────────────
let personaCache: { id: string; at: number } | null = null;
const PERSONA_TTL_MS = 60_000;

async function getPersonaId(): Promise<string> {
  if (personaCache && Date.now() - personaCache.at < PERSONA_TTL_MS) return personaCache.id;
  const { data } = await sb().from("ai_personas").select("id").eq("slug", "kawai").maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new HttpError(500, "ai_personas(slug=kawai) が見つかりません");
  personaCache = { id, at: Date.now() };
  return id;
}

// ── 検索 ─────────────────────────────────────────────────────
/** 上位 k 件を返す。v2 と旧検索を環境変数で切り替える。 */
export async function retrieveKnowledge(
  message: string, k = 8, opts: RetrieveOptions = {},
): Promise<KnowledgeRow[]> {
  const emb = await embedText(message);
  const q = message.slice(0, 500);

  if (!useSearchV2()) {
    const { data, error } = await sb().rpc("knowledge_public_search", {
      q, q_emb: toVectorLiteral(emb), k,
    });
    if (error) throw new HttpError(502, "ナレッジ検索に失敗しました");
    const rows = (data as RpcRowV1[] | null) ?? [];
    return rows
      .filter((r) => (r.score ?? 0) > 0)
      .map((r) => ({
        chunkId: r.chunk_id, documentId: r.document_id, sourceType: r.source_type,
        title: r.title, url: r.canonical_url, text: r.chunk_text, score: r.score,
        vec: 0, kw: 0, freshness: null,
      }));
  }

  const [personaId, cfg] = await Promise.all([getPersonaId(), loadProjectConfig(PROJECT_SLUG)]);
  const { data, error } = await sb().rpc("knowledge_search_v2", {
    p_persona_id: personaId,
    p_query: q,
    p_emb: toVectorLiteral(emb),
    p_member_attrs: opts.memberAttrIds ?? null,
    p_source_types: opts.sourceTypes ?? null,
    p_threshold: opts.threshold ?? cfg.retrieval.threshold,
    p_candidates: cfg.retrieval.candidates,
    p_k: k,
  });
  if (error) throw new HttpError(502, "ナレッジ検索に失敗しました");
  const rows = (data as RpcRowV2[] | null) ?? [];
  return rows.map((r) => ({
    chunkId: r.chunk_id, documentId: r.document_id, sourceType: r.source_type,
    title: r.title, url: r.canonical_url, text: r.chunk_text, score: r.score,
    vec: r.vec_score ?? 0, kw: r.kw_score ?? 0, freshness: r.freshness ?? null,
  }));
}
