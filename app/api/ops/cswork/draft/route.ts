// ============================================================
// POST /api/ops/cswork/draft  … ラフmd を整形して差分と検証結果を返す（REQ-039）
//
//   body: { sourceMd: string, specJson?: string, accept?: string[], filename?: string }
//
//   **保存しない。** 画面が「STEP 2 整形結果」を描くための試算に徹する。
//   確定は POST /api/ops/cswork/approve。
//
//   ⚠️ 承認・整形は管理者のみ（確定：起草と整形／実行は管理者に限定）。
//   ⚠️ spec JSON は外部（Claude セッション）で作られることがあるため、
//      parseSpec で spec_version を確認してから使う。
// ============================================================
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOrigin, errorResponse, HttpError } from "../../../../../lib/authz";
import { draftSpec } from "../../../../../lib/csWork/draftServer";
import { audit } from "../../../../../lib/csWork/server";
import { errMessage } from "../../../../../lib/errors";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const me = await requireAdmin(request);

    const body = await request.json().catch(() => null) as
      { sourceMd?: string; specJson?: string; accept?: string[]; filename?: string } | null;

    const sourceMd = body?.sourceMd ?? "";
    if (!sourceMd.trim()) throw new HttpError(400, "起草mdが空です");
    if (sourceMd.length > MAX_BYTES) throw new HttpError(413, "ファイルが大きすぎます（5MBまで）");
    if ((body?.specJson ?? "").length > MAX_BYTES) throw new HttpError(413, "spec JSON が大きすぎます（5MBまで）");

    let outcome;
    try {
      outcome = await draftSpec({
        sourceMd,
        specJson: body?.specJson,
        accept: body?.accept,
        filename: body?.filename,
      });
    } catch (e: unknown) {
      // spec JSON の形が違う／JSON として壊れている場合は 400 で返す（500 にしない）
      throw new HttpError(400, `整形できませんでした：${errMessage(e, "内容を確認してください")}`);
    }

    await audit("normalize", me.memberId, null, {
      normalizedBy: outcome.normalizedBy,
      ...outcome.summary,
      issues: outcome.issues.length,
    });

    return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
