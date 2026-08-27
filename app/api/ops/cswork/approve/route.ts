// ============================================================
// POST /api/ops/cswork/approve  … 整形結果を承認して現行版にする（REQ-039）
//
//   body: { sourceMd: string, specJson?: string, accept?: string[], filename?: string }
//
//   1回の承認で source / spec / settings / runbook を同じ doc_version で束ねる。
//   併せて指示ファイルを再生成し、解消した課題を自動クローズする。
//
//   ⚠️ MISSING_HUMAN_GATE がある間は承認できない（唯一、承認そのものを止める
//      blocker）。他の blocker は「実行不可のまま承認」を許す。
//   ⚠️ 管理者のみ。
// ============================================================
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOrigin, errorResponse, HttpError } from "../../../../../lib/authz";
import { approveSpec } from "../../../../../lib/csWork/draftServer";
import { errMessage } from "../../../../../lib/errors";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const me = await requireAdmin(request);

    const body = await request.json().catch(() => null) as
      { sourceMd?: string; specJson?: string; accept?: string[]; filename?: string } | null;

    const sourceMd = body?.sourceMd ?? "";
    if (!sourceMd.trim()) throw new HttpError(400, "起草mdが空です");
    if (sourceMd.length > MAX_BYTES) throw new HttpError(413, "ファイルが大きすぎます（5MBまで）");

    let outcome;
    try {
      outcome = await approveSpec({
        sourceMd,
        specJson: body?.specJson,
        accept: body?.accept,
        filename: body?.filename,
      }, me.memberId);
    } catch (e: unknown) {
      throw new HttpError(400, errMessage(e, "承認できませんでした"));
    }

    return NextResponse.json({
      docVersion: outcome.docVersion,
      summary: outcome.summary,
      stats: outcome.stats,
      issues: outcome.issues,
      issueSync: outcome.issueSync,
      runbookDocId: outcome.runbookDocId,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
