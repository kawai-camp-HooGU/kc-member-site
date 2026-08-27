// ============================================================
// PATCH /api/ops/cswork/issues/[id]  … 課題のクローズ・担当変更（REQ-039）
//
//   body: { status?: "open"|"resolved"|"wontfix", resolution?: string, assignee?: string,
//           toDraft?: boolean }
//
//   toDraft を立てると、判断内容を含んだラフmd の下書きを返す。
//   これが STEP 8（判断）→ STEP 1（起草）の導線そのもの。
//   **未確定条件に人が判断を下したら、その判断は次から AI が答えてよい知識になる。**
//
//   ⚠️ 運営ロールで実行できる（判断を記録するのは CS担当・川合さんのため）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireSameOrigin, errorResponse, HttpError } from "../../../../../../lib/authz";
import { closeIssue, fetchIssues, setIssueAssignee, type IssueStatus } from "../../../../../../lib/csWork/runsServer";
import { audit } from "../../../../../../lib/csWork/server";

export const dynamic = "force-dynamic";

const STATUSES: readonly IssueStatus[] = ["open", "resolved", "wontfix"];

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
      { status?: string; resolution?: string; assignee?: string; toDraft?: boolean } | null;

    let row = null;

    if (body?.assignee !== undefined) {
      row = await setIssueAssignee(id, (body.assignee ?? "").trim() || null);
    }

    if (body?.status !== undefined) {
      const status = body.status as IssueStatus;
      if (!STATUSES.includes(status)) throw new HttpError(400, "状態の値が不正です");
      const resolution = (body.resolution ?? "").trim();
      if (status !== "open" && !resolution) {
        throw new HttpError(400, "解消の内容を書いてください（次のドキュメント更新の材料になります）");
      }
      row = await closeIssue(id, status, resolution || null, me.memberId);
      await audit("close_issue", me.memberId, null, { issue_id: id, status });
    }

    if (!row) {
      const found = (await fetchIssues("all")).find((x) => x.id === id);
      if (!found) throw new HttpError(404, "課題が見つかりません");
      row = found;
    }

    return NextResponse.json({
      issue: row,
      draftMd: body?.toDraft ? toDraftMd(row.title, row.detail, row.resolution, row.funnel, row.task_id) : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * 課題の判断内容を「次のラフmd」の下書きにする。
 *   人はこれを「起草と整形」に貼り、必要なら書き足してから承認する。
 */
function toDraftMd(
  title: string,
  detail: string | null,
  resolution: string | null,
  funnel: string | null,
  taskId: string | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${funnel ?? "共通"}`);
  lines.push("");
  lines.push("## 判断の記録");
  lines.push(`- ${title}`);
  if (detail) lines.push(`- 状況：${detail}`);
  if (resolution) lines.push(`- 決めたこと：${resolution}`);
  if (taskId) lines.push(`- 対象タスク：${taskId}`);
  lines.push("");
  lines.push("## タスク");
  lines.push("");
  lines.push(`### ${title}への対応`);
  lines.push(`- ${resolution ?? "（決めた内容をここに書く）"}`);
  lines.push("- @gate: 送信は人が実施する");
  lines.push("");
  return lines.join("\n");
}
