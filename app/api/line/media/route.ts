// ============================================================
// LINE 受信メディアの署名URL発行（GET ?messageId=）
//   運営のみ。非公開バケット line-media の一時URLを返す。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { createLineMediaSignedUrl } from "../../../../lib/lineServer";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireOps(request);
    const { searchParams } = new URL(request.url);
    const idRaw = searchParams.get("messageId");
    const messageId = idRaw ? Number(idRaw) : NaN;
    if (!Number.isFinite(messageId)) throw new HttpError(400, "messageId が不正です");

    const url = await createLineMediaSignedUrl(messageId);
    if (!url) throw new HttpError(404, "メディアが見つかりません");

    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
