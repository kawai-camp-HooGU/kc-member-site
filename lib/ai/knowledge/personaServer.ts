// ============================================================
// ペルソナ（事実 / 意見 / 文体）— service_role 専用（フェーズB / 正本 §12）
//   ・回答生成で使う「承認済みの本人情報」と「文体ガイド」を組み立てる。
//   ・断定できるのは status='approved' のみ（§12回答規則）。
//   ・chunk から fact/position 候補を抽出（status='candidate' で保存、承認は別途）。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../supabaseAdmin";
import { HttpError } from "../../authz";
import { callClaude, parseJson } from "../claude";

const sb = supabaseAdmin as unknown as SupabaseClient;

async function personaId(): Promise<string | null> {
  const { data } = await sb.from("ai_personas").select("id").eq("slug", "kawai").maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

// ── 文体ガイド（medium=common/chat の approved を要約）──────────
type Rules = Record<string, unknown>;
const isTrue = (v: unknown): boolean => v === true;
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numOf = (v: unknown): number | null => (typeof v === "number" ? v : null);

function formatRules(medium: string, r: Rules): string {
  const g: string[] = [];
  if (isTrue(r.conclusion_first)) g.push("結論を先に述べる");
  if (r.sentence_length === "short") g.push("短文・言い切り中心");
  const avoid = strArr(r.avoid);
  if (avoid.length) g.push(`避ける: ${avoid.join("・")}`);
  if (medium === "chat") {
    const n = numOf(r.answer_within_first_sentences);
    if (n) g.push(`最初の${n}文で回答する`);
    const order = strArr(r.detail_order);
    if (order.length) g.push(`補足は ${order.join("→")} の順`);
    if (r.sales_cta === false) g.push("販売CTAを持ち込まない");
    if (r.guess_personal_facts === false) g.push("不明な人物事実を推測しない");
  }
  return g.join("、");
}

export async function loadStyleGuide(): Promise<string> {
  const pid = await personaId();
  if (!pid) return "";
  const { data } = await sb.from("persona_style_profiles")
    .select("medium, rules_json").eq("persona_id", pid).eq("status", "approved").in("medium", ["common", "chat"]);
  const rows = (data as { medium: string; rules_json: Rules }[] | null) ?? [];
  const lines = rows
    .sort((a) => (a.medium === "common" ? -1 : 1))
    .map((r) => formatRules(r.medium, r.rules_json ?? {}))
    .filter(Boolean);
  return lines.join(" / ");
}

// ── 承認済みの本人情報ブロック ────────────────────────────────
interface FactRow { subject_key: string; predicate: string; value_json: unknown }
interface PosRow { statement: string; stance: string; conditions: unknown; exceptions: unknown }

export async function loadApprovedPersona(): Promise<string> {
  const pid = await personaId();
  if (!pid) return "";
  const [{ data: facts }, { data: pos }] = await Promise.all([
    sb.from("persona_facts").select("subject_key, predicate, value_json")
      .eq("persona_id", pid).eq("status", "approved").limit(40),
    sb.from("persona_positions").select("statement, stance, conditions, exceptions")
      .eq("persona_id", pid).eq("status", "approved").limit(20),
  ]);
  const factRows = (facts as FactRow[] | null) ?? [];
  const posRows = (pos as PosRow[] | null) ?? [];
  if (factRows.length === 0 && posRows.length === 0) return "";

  const parts: string[] = [];
  if (factRows.length) {
    parts.push("【本人の確定情報（承認済みのみ。これ以外を本人の事実として断定しない）】");
    for (const f of factRows) {
      const v = typeof f.value_json === "string" ? f.value_json : JSON.stringify(f.value_json);
      parts.push(`- ${f.subject_key} ${f.predicate}: ${v}`);
    }
  }
  if (posRows.length) {
    parts.push("【本人の見解（条件・例外を含めて扱う）】");
    for (const p of posRows) {
      const cond = Array.isArray(p.conditions) && p.conditions.length ? ` 条件:${JSON.stringify(p.conditions)}` : "";
      const exc = Array.isArray(p.exceptions) && p.exceptions.length ? ` 例外:${JSON.stringify(p.exceptions)}` : "";
      parts.push(`- (${p.stance}) ${p.statement}${cond}${exc}`);
    }
  }
  return parts.join("\n");
}

// ── 候補抽出（chunk → fact/position 候補。承認は人が行う）──────
interface ExtractOut {
  facts?: { fact_type: string; subject_key: string; predicate: string; value: string; confidence?: number }[];
  positions?: { position_key: string; stance: string; statement: string; confidence?: number }[];
}
const FACT_TYPES = ["identity", "credential", "experience", "role", "offer", "audience", "preference", "metric", "relationship"];
const STANCES = ["support", "oppose", "conditional", "neutral"];

/** 本人発言 chunk から fact/position 候補を抽出し candidate として保存する。 */
export async function extractPersonaCandidates(limit = 10): Promise<{ scanned: number; facts: number; positions: number }> {
  const pid = await personaId();
  if (!pid) throw new HttpError(500, "ai_personas(kawai) が見つかりません。");

  // 本人発言（author voice）の chunk を対象に、まだ候補化していないものを拾う
  const { data } = await sb.rpc("knowledge_public_search", { q: "本人 経歴 実績 主張", q_emb: "", k: limit });
  const rows = (data as { chunk_id: number; chunk_text: string }[] | null) ?? [];

  let facts = 0, positions = 0;
  for (const r of rows) {
    const raw = await callClaude({
      feature: "bot_public",
      system: "次の文章から、話者本人の『事実』と『意見(position)』の候補だけをJSONで抽出します。" +
        "推測や一般論は含めない。該当なしは空配列。" +
        `出力: {"facts":[{"fact_type":"${FACT_TYPES.join("|")}","subject_key":"","predicate":"","value":"","confidence":0.0}],` +
        `"positions":[{"position_key":"","stance":"${STANCES.join("|")}","statement":"","confidence":0.0}]}`,
      messages: [{ role: "user", content: (r.chunk_text ?? "").slice(0, 1500) }],
      maxTokens: 500, temperature: 0, callerMemberId: null,
    });
    const out = parseJson<ExtractOut>(raw);
    if (!out) continue;

    for (const f of out.facts ?? []) {
      if (!f.subject_key || !FACT_TYPES.includes(f.fact_type)) continue;
      await sb.from("persona_facts").insert({
        persona_id: pid, fact_type: f.fact_type, subject_key: f.subject_key, predicate: f.predicate ?? "",
        value_json: JSON.stringify({ value: f.value ?? "" }), status: "candidate",
        confidence: typeof f.confidence === "number" ? f.confidence : 0.5, source_chunk_id: r.chunk_id,
      });
      facts++;
    }
    for (const p of out.positions ?? []) {
      if (!p.statement || !STANCES.includes(p.stance)) continue;
      await sb.from("persona_positions").insert({
        persona_id: pid, position_key: p.position_key ?? p.statement.slice(0, 40), stance: p.stance,
        statement: p.statement, strength: typeof p.confidence === "number" ? p.confidence : 0.5,
        status: "candidate", source_chunk_id: r.chunk_id,
      });
      positions++;
    }
  }
  return { scanned: rows.length, facts, positions };
}
