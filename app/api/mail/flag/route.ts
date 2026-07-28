// ============================================================
// 既読/スターの IMAP 反映（運営のみ・best-effort）
//   POST /api/mail/flag { id, isRead?, isStarred? } → { ok }
//   DB はクライアントが RLS で更新済み。ここは IMAP(\Seen/\Flagged)へ反映するだけ。
//   ⚠️ imapflow は Node ランタイム専用。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { pushMailFlagToImap } from "../../../../lib/mailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const { id, isRead, isStarred } = (await request.json()) as { id?: number; isRead?: boolean; isStarred?: boolean };
    if (id == null) throw new HttpError(400, "id は必須です");
    await pushMailFlagToImap(id, { isRead, isStarred });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
