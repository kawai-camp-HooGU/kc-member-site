// ============================================================
// POST /api/bot/knowledge/eval — 検索評価の実行（管理・フェーズB / 正本 §17）
//   ・運営(requireOps)のみ。fixtures/eval/retrieval-cases.json を公開検索へ通す。
//   ⚠️ migration 適用・knowledge 同期済み・OPENAI_API_KEY が前提。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse } from "../../../../../lib/authz";
import { runEval } from "../../../../../lib/ai/knowledge/eval";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const summary = await runEval();
    return NextResponse.json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
