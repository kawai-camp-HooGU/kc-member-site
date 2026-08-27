// ============================================================
// GET  /api/ops/cswork/runs  … 実行履歴（新しい順）
// POST /api/ops/cswork/runs  … 実行結果を取り込む（REQ-039・設計書 §9-3）
//
//   body（POST）: result JSON そのもの、または { result: {...} }
//
//   ⚠️ 確定5：Phase 1 では専用 API 鍵を発行しない。**画面から貼り付ける**導線
//      だけを用意し、認可は管理者セッション（requireAdmin）で行う。
//      エージェントが直接叩けるようにするのは Phase 2。
//   ⚠️ 同じ run_id での再投入は上書き（エージェントの再送で二重にしない）。
//   ⚠️ 実行できなかったタスクは必ず課題になる。ここで落とすとループが閉じない。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireAdmin, requireSameOrigin, errorResponse, HttpError } from "../../../../../lib/authz";
import { fetchCurrent } from "../../../../../lib/csWork/server";
import { fetchRuns, ingestRun, type RunResultPayload } from "../../../../../lib/csWork/runsServer";
import { errMessage } from "../../../../../lib/errors";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  try {
    await requireOps(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
    const items = await fetchRuns(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 30);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const me = await requireAdmin(request);

    const raw = await request.text();
    if (!raw.trim()) throw new HttpError(400, "実行結果が空です");
    if (raw.length > MAX_BYTES) throw new HttpError(413, "実行結果が大きすぎます（2MBまで）");

    let payload: RunResultPayload;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const inner = parsed.result;
      payload = (inner && typeof inner === "object" ? inner : parsed) as RunResultPayload;
    } catch (e: unknown) {
      throw new HttpError(400, `JSON として読めません：${errMessage(e, "書式を確認してください")}`);
    }

    const runbook = await fetchCurrent("runbook", payload.runner ?? "agent-browser");
    const run = await ingestRun(payload, runbook?.id ?? null, me.memberId);

    return NextResponse.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
