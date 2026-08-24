// ============================================================
// AI回答トレースの参照（管理者のみ）
//   GET ?mode=list    … 一覧（重い列は返さない）
//   GET ?mode=detail&id=123 … 1件の全文（system / messages / 検索の採点）
//   GET ?mode=summary&days=30 … 機能別の利用状況（RPC ai_usage_summary）
//
//   ⚠️ ai_traces は顧客の個人情報を含む。requireAdmin ＋ RLS（管理者のみ）で二重に守る。
//   ⚠️ 一覧では system_prompt / messages_json を返さない（1行が重くなるため）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";
import type {
  AiTraceRow, AiTraceDetail, AiTraceState, AiUsageSummaryRow,
} from "../../../../lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = supabaseAdmin as unknown as SupabaseClient;

/** 一覧で取る列（重い列は含めない） */
const LIST_COLS =
  "id, created_at, feature, entry, request_id, user_input, model, confidence, " +
  "refused, needs_human, ok, retry_count, tokens_in, tokens_out, cost_jpy, " +
  "latency_ms, total_ms, used_sources, error";

interface ListRaw {
  id: number; created_at: string; feature: string; entry: string; request_id: string;
  user_input: string; model: string; confidence: number | null;
  refused: boolean; needs_human: boolean; ok: boolean; retry_count: number;
  tokens_in: number; tokens_out: number; cost_jpy: number | string;
  latency_ms: number; total_ms: number; used_sources: unknown; error: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};
const arrLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

const isState = (v: string | null): v is AiTraceState =>
  v === "refused" || v === "error" || v === "needs_human" || v === "retried" || v === "rated_bad";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "list";

    // ── 利用状況（機能別の集計）──
    if (mode === "summary") {
      const days = Math.min(Math.max(1, Number(url.searchParams.get("days") ?? 30)), 365);
      const { data, error } = await sb.rpc("ai_usage_summary", { p_days: days });
      if (error) throw new HttpError(500, error.message);
      const rows: AiUsageSummaryRow[] = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
        feature: String(r.feature ?? ""),
        calls: num(r.calls),
        tokensIn: num(r.tokens_in),
        tokensOut: num(r.tokens_out),
        costJpy: num(r.cost_jpy),
        avgMs: num(r.avg_ms),
        p95Ms: num(r.p95_ms),
        errors: num(r.errors),
        refused: num(r.refused),
      }));
      // 単価が1件でも設定されていれば金額を表示する（すべて 0 なら「単価未設定」）
      const { data: prices } = await sb
        .from("ai_model_prices")
        .select("model")
        .or("input_jpy_per_1k.gt.0,output_jpy_per_1k.gt.0");
      return NextResponse.json({ rows, days, priceConfigured: ((prices as unknown[] | null) ?? []).length > 0 });
    }

    // ── 1件の詳細（全文）──
    if (mode === "detail") {
      const id = Number(url.searchParams.get("id") ?? 0);
      if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "id が不正です");

      const { data, error } = await sb.from("ai_traces").select("*").eq("id", id).maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!data) throw new HttpError(404, "トレースが見つかりません");
      const r = data as Record<string, unknown>;

      const { data: fb } = await sb
        .from("ai_feedback").select("rating, reason, created_at").eq("trace_id", id)
        .order("created_at", { ascending: false }).limit(5);

      const detail: AiTraceDetail = {
        id: num(r.id),
        createdAt: String(r.created_at ?? ""),
        feature: String(r.feature ?? ""),
        entry: String(r.entry ?? ""),
        requestId: String(r.request_id ?? ""),
        memberId: r.member_id == null ? null : num(r.member_id),
        subjectKey: String(r.subject_key ?? ""),
        userInput: String(r.user_input ?? ""),
        rewrittenQuery: r.rewritten_query == null ? null : String(r.rewritten_query),
        systemPrompt: String(r.system_prompt ?? ""),
        messagesJson: Array.isArray(r.messages_json) ? (r.messages_json as unknown[]) : [],
        promptVersion: String(r.prompt_version ?? ""),
        retrieval: Array.isArray(r.retrieval_json) ? (r.retrieval_json as unknown[]) : [],
        usedSources: Array.isArray(r.used_sources) ? (r.used_sources as unknown[]) : [],
        answer: String(r.answer ?? ""),
        confidence: r.confidence == null ? null : num(r.confidence),
        refused: Boolean(r.refused),
        needsHuman: Boolean(r.needs_human),
        model: String(r.model ?? ""),
        temperature: r.temperature == null ? null : num(r.temperature),
        maxTokens: r.max_tokens == null ? null : num(r.max_tokens),
        tokensIn: num(r.tokens_in),
        tokensOut: num(r.tokens_out),
        costJpy: num(r.cost_jpy),
        latencyMs: num(r.latency_ms),
        totalMs: num(r.total_ms),
        retryCount: num(r.retry_count),
        ok: Boolean(r.ok),
        error: r.error == null ? null : String(r.error),
        feedback: ((fb as Record<string, unknown>[] | null) ?? []).map((f) => ({
          rating: num(f.rating), reason: String(f.reason ?? ""), createdAt: String(f.created_at ?? ""),
        })),
      };
      return NextResponse.json({ detail });
    }

    // ── 一覧 ──
    const days = Math.min(Math.max(1, Number(url.searchParams.get("days") ?? 1)), 365);
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 100)), 500);
    const feature = url.searchParams.get("feature");
    const stateRaw = url.searchParams.get("state");
    const state = isState(stateRaw) ? stateRaw : null;
    const since = new Date(Date.now() - days * 864e5).toISOString();

    let q = sb.from("ai_traces").select(LIST_COLS, { count: "exact" })
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (feature) q = q.eq("feature", feature);
    if (state === "refused")     q = q.eq("refused", true);
    if (state === "error")       q = q.eq("ok", false);
    if (state === "needs_human") q = q.eq("needs_human", true);
    if (state === "retried")     q = q.gt("retry_count", 0);

    // 「評価が悪い」は別テーブルなので、先に trace_id を集めてから絞る。
    // ⚠️ 件数が上限に達したら黙って切らずに、その旨が分かるよう limit と同じ数で頭打ちにする。
    if (state === "rated_bad") {
      const { data: bad } = await sb.from("ai_feedback")
        .select("trace_id").eq("rating", -1)
        .order("created_at", { ascending: false }).limit(limit);
      const ids = ((bad as { trace_id: number }[] | null) ?? []).map((r) => r.trace_id);
      if (ids.length === 0) {
        return NextResponse.json({ rows: [], total: 0, days, limit });
      }
      q = q.in("id", ids);
    }

    const { data, error, count } = await q;
    if (error) throw new HttpError(500, error.message);

    // 一覧に評価を出す（1トレース1評価）。行数ぶんを1クエリで引く。
    const listIds = ((data as unknown as ListRaw[] | null) ?? []).map((r) => r.id);
    const ratingOf = new Map<number, number>();
    if (listIds.length > 0) {
      const { data: fb } = await sb.from("ai_feedback").select("trace_id, rating").in("trace_id", listIds);
      for (const f of (fb as { trace_id: number; rating: number }[] | null) ?? []) {
        ratingOf.set(f.trace_id, f.rating);
      }
    }

    const rows: AiTraceRow[] = ((data as unknown as ListRaw[] | null) ?? []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      feature: r.feature,
      entry: r.entry,
      requestId: r.request_id,
      userInput: (r.user_input ?? "").slice(0, 120),
      model: r.model,
      confidence: r.confidence,
      refused: r.refused,
      needsHuman: r.needs_human,
      ok: r.ok,
      retryCount: r.retry_count,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      costJpy: num(r.cost_jpy),
      latencyMs: r.latency_ms,
      totalMs: r.total_ms,
      sourceCount: arrLen(r.used_sources),
      error: r.error,
      rating: ratingOf.get(r.id) ?? null,
    }));

    return NextResponse.json({ rows, total: count ?? rows.length, days, limit });
  } catch (err) {
    return errorResponse(err);
  }
}
