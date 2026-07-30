// ============================================================
// POST /api/bot/knowledge/persona — ペルソナ候補抽出（管理・フェーズB）
//   ・運営(requireOps)のみ。
//   ・body: { action: 'extract', limit?: number }
//   ・chunk から fact/position 候補を抽出し status='candidate' で保存（承認は別途）。
//   ⚠️ migration 適用・knowledge 同期済み・OPENAI/ANTHROPIC キーが前提。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../../lib/authz";
import { extractPersonaCandidates } from "../../../../../lib/ai/knowledge/personaServer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const body = (await request.json().catch(() => ({}))) as { action?: string; limit?: number };
    if (body.action !== "extract") throw new HttpError(400, "action は 'extract' を指定してください。");
    const limit = Math.min(Math.max(1, body.limit ?? 10), 50);
    const result = await extractPersonaCandidates(limit);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
