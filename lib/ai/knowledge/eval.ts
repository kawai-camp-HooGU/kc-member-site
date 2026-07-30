// ============================================================
// 検索評価ハーネス（フェーズB / 正本 §17）
//   ・fixtures/eval/retrieval-cases.json を公開検索へ通し、受け入れ条件を判定。
//   ・expected_contains が上位結果に含まれるか、must_not_use が漏れていないか。
//   ⚠️ runEval は knowledge_public_search（DB＋埋め込み）を使うため、
//      migration 適用・knowledge 同期済み・OPENAI_API_KEY が前提。
// ============================================================
import { readFile } from "fs/promises";
import { join } from "path";
import { retrieveKnowledge } from "./retrieveServer";

export interface EvalCase {
  id: string;
  query: string;
  expected_source: string | null;
  expected_contains: string[];
  must_not_use: string[];
  requires_freshness_warning?: boolean;
  requires_multiple_units?: boolean;
}

export interface EvalResult {
  id: string;
  pass: boolean;
  missing: string[];   // 期待したが含まれなかった語
  leaked: string[];    // 出てはいけないのに含まれた語
  topSources: string[];
}

/** 結果テキストに対して1ケースを判定する純粋関数。 */
export function evaluateCase(c: EvalCase, resultText: string, topSources: string[]): EvalResult {
  const missing = c.expected_contains.filter((s) => !resultText.includes(s));
  const leaked = c.must_not_use.filter((s) => resultText.includes(s));
  return { id: c.id, pass: missing.length === 0 && leaked.length === 0, missing, leaked, topSources };
}

export async function loadEvalCases(): Promise<EvalCase[]> {
  const p = join(process.cwd(), "fixtures", "eval", "retrieval-cases.json");
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw) as EvalCase[];
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
}

/** 全ケースを公開検索で実行して判定する。 */
export async function runEval(): Promise<EvalSummary> {
  const cases = await loadEvalCases();
  const results: EvalResult[] = [];
  for (const c of cases) {
    const rows = await retrieveKnowledge(c.query, 8);
    const resultText = rows.map((r) => `${r.title ?? ""}\n${r.text}`).join("\n");
    const topSources = rows.slice(0, 3).map((r) => `${r.sourceType}:${r.title ?? r.documentId}`);
    results.push(evaluateCase(c, resultText, topSources));
  }
  const passed = results.filter((r) => r.pass).length;
  return { total: cases.length, passed, failed: cases.length - passed, results };
}
