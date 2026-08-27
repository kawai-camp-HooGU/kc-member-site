// ============================================================
// PATCH /api/ops/cswork/actions/[id]  … 次アクション提案の採否を記録する（REQ-039）
//
//   body: { decision: "adopted"|"rejected"|"held"|"pending", rejectReason?: string }
//
//   採用したものが「要対応一覧」になる。**送信は人が行う**（このAPIは判断の記録だけ）。
//   却下理由は次回の提案精度の材料として残す。
//
//   ⚠️ 運営ロールで実行できる（日々の判断は CS担当が行うため）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../../../lib/authz";
import { decideAction, type ActionDecision } from "../../../../../../lib/csWork/runsServer";
import { audit } from "../../../../../../lib/csWork/server";

export const dynamic = "force-dynamic";

const DECISIONS: readonly ActionDecision[] = ["pending", "adopted", "rejected", "held"];

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const me = await requireOps(request);

    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "IDが不正です");

    const body = await request.json().catch(() => null) as
      { decision?: string; rejectReason?: string } | null;
    const decision = (body?.decision ?? "") as ActionDecision;
    if (!DECISIONS.includes(decision)) throw new HttpError(400, "決定の値が不正です");

    const reason = (body?.rejectReason ?? "").trim();
    if (decision === "rejected" && !reason) {
      throw new HttpError(400, "却下の理由を書いてください（次回の提案精度に使います）");
    }

    const row = await decideAction(id, decision, me.memberId, reason || null);
    await audit("decide", me.memberId, null, { action_id: id, decision });

    return NextResponse.json({ action: row });
  } catch (err) {
    return errorResponse(err);
  }
}
