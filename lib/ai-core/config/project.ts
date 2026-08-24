// ============================================================
// プロジェクト設定のロード（Ph3・AI Core）
//
//   優先順位は  DB ?? 環境変数 ?? コード既定  の3段。
//   ・DB に無い／null のキーは、これまでどおり環境変数で動く。
//     → migration_add_ai_projects.sql を適用していなくても挙動は変わらない。
//   ・環境変数も無ければコード既定。
//
//   ⚠️ Vercel のサーバーレス関数はインスタンスごとに独立したメモリを持つ。
//      60秒キャッシュは「インスタンスごとに最大60秒古い設定で動く」という意味。
//      設定変更が全インスタンスへ行き渡るまで最大60秒かかる。
//      ※ 現行の campContextBlock() はプロセスが生きているあいだ永久キャッシュなので、
//        これでも改善にはなっている。
//
//   ⚠️ AI Core。PJ固有のテーブルをここから参照しないこと。
//   ⚠️ APIキーはここで扱わない。環境変数のまま。
// ============================================================
import { coreDb } from "../db";

export interface ModelConfig {
  default: string | null;
  light: string | null;
  embed: string | null;
}
export interface RetrievalConfig {
  top_k: number;
  candidates: number;
  threshold: number;
  weights: { vec: number; kw: number; authority: number; fresh: number };
}
export interface MemoryConfig {
  turns: number;
  summarize_after: number;
  retention_days: number;
  transcript_limit: number | null;
}
export interface OutputConfig {
  max_chars: number;
  language: string;
  show_sources: boolean;
  show_confidence: boolean;
}
export interface LimitsConfig {
  per_min: number | null;
  per_day: Record<string, number>;
}
export interface PiiConfigValue {
  mask: string[];
  keep: string[];
}
export interface RulesConfig {
  fail_mode: "closed" | "open";
  human_gate: string[];
  do_not_claim: string[];
}

export interface ProjectConfig {
  projectId: number | null;
  personaId: string | null;
  model: ModelConfig;
  retrieval: RetrievalConfig;
  memory: MemoryConfig;
  output: OutputConfig;
  limits: LimitsConfig;
  pii: PiiConfigValue;
  rules: RulesConfig;
  /** DB から読めたか（false＝環境変数とコード既定だけで動いている） */
  fromDb: boolean;
}

// ── コード既定（DBにも環境変数にも無いときの最後の砦）──
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const envNum = (name: string): number | undefined => {
  const raw = process.env[name];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/** DB ?? 環境変数 ?? 既定 */
function pick<T>(dbValue: T | null | undefined, envValue: T | undefined, fallback: T): T {
  return dbValue ?? envValue ?? fallback;
}

const TTL_MS = 60_000;
let cache: { at: number; slug: string; cfg: ProjectConfig } | null = null;

interface Row { key: string; value_json: Record<string, unknown> }

function build(slug: string, projectId: number | null, personaId: string | null, rows: Row[]): ProjectConfig {
  const by = new Map(rows.map((r) => [r.key, r.value_json ?? {}]));
  const g = (k: string): Record<string, unknown> => by.get(k) ?? {};

  const m = g("model");
  const r = g("retrieval");
  const rw = (r.weights ?? {}) as Record<string, unknown>;
  const mem = g("memory");
  const o = g("output");
  const l = g("limits");
  const pi = g("pii");
  const ru = g("rules");

  return {
    projectId,
    personaId,
    fromDb: rows.length > 0,
    model: {
      default: pick(str(m.default), str(process.env.ANTHROPIC_MODEL), null),
      light:   pick(str(m.light),   str(process.env.ANTHROPIC_MODEL_LIGHT), null),
      embed:   pick(str(m.embed),   str(process.env.OPENAI_EMBED_MODEL), "text-embedding-3-small"),
    },
    retrieval: {
      top_k:      pick(typeof r.top_k === "number" ? r.top_k : null, envNum("AI_SEARCH_TOPK"), 8),
      candidates: pick(typeof r.candidates === "number" ? r.candidates : null, envNum("AI_SEARCH_CANDIDATES"), 20),
      // ⚠️ 閾値は R6 で実データを見て決めるまで 0（＝閾値なし）。未検証の値を既定にしない。
      threshold:  pick(typeof r.threshold === "number" ? r.threshold : null, envNum("AI_SEARCH_THRESHOLD"), 0),
      weights: {
        vec:       num(rw.vec, 0.50),
        kw:        num(rw.kw, 0.30),
        authority: num(rw.authority, 0.15),
        fresh:     num(rw.fresh, 0.05),
      },
    },
    memory: {
      turns:           num(mem.turns, 8),
      summarize_after: num(mem.summarize_after, 16),
      retention_days:  num(mem.retention_days, 30),
      transcript_limit: pick(
        typeof mem.transcript_limit === "number" ? mem.transcript_limit : null,
        envNum("AI_MAX_CONTEXT_MESSAGES"), 40),
    },
    output: {
      max_chars:       num(o.max_chars, 300),
      language:        str(o.language) ?? "ja",
      show_sources:    o.show_sources !== false,
      show_confidence: o.show_confidence !== false,
    },
    limits: {
      per_min: pick(typeof l.per_min === "number" ? l.per_min : null, envNum("AI_RATE_LIMIT_PER_MIN"), null),
      per_day: (l.per_day ?? {}) as Record<string, number>,
    },
    pii: {
      mask: Array.isArray(pi.mask) ? (pi.mask as string[]) : ["email", "tel"],
      keep: Array.isArray(pi.keep) ? (pi.keep as string[]) : ["name"],
    },
    rules: {
      fail_mode: ru.fail_mode === "open" ? "open" : "closed",
      human_gate: Array.isArray(ru.human_gate) ? (ru.human_gate as string[]) : [],
      do_not_claim: Array.isArray(ru.do_not_claim) ? (ru.do_not_claim as string[]) : [],
    },
  };
}

/**
 * 設定を読む（プロセス内で60秒キャッシュ）。
 * ⚠️ テーブル未適用・読み取り失敗でも throw しない。
 *    設定が読めないことでAI機能が全面停止するほうが被害が大きいため、
 *    環境変数とコード既定だけで組み立てて返す（fromDb=false）。
 */
export async function loadProjectConfig(slug: string): Promise<ProjectConfig> {
  if (cache && cache.slug === slug && Date.now() - cache.at < TTL_MS) return cache.cfg;

  let projectId: number | null = null;
  let personaId: string | null = null;
  let rows: Row[] = [];

  try {
    const db = coreDb();
    const { data: proj } = await db
      .from("ai_projects").select("id, persona_id")
      .eq("slug", slug).eq("is_deleted", false).maybeSingle();
    const p = proj as { id?: number; persona_id?: string | null } | null;
    projectId = p?.id ?? null;
    personaId = p?.persona_id ?? null;

    if (projectId != null) {
      const { data } = await db
        .from("ai_project_configs").select("key, value_json").eq("project_id", projectId);
      rows = (data as Row[] | null) ?? [];
    }
  } catch {
    // 未適用・接続断など。環境変数とコード既定で動かす（develop.md §9：本処理を止めない）
  }

  const cfg = build(slug, projectId, personaId, rows);
  cache = { at: Date.now(), slug, cfg };
  return cfg;
}

/** 設定を保存したあとに呼ぶ。次の読み出しで必ずDBを引き直す。 */
export function invalidateProjectConfig(): void {
  cache = null;
}
