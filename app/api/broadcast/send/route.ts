import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { runBroadcast } from "../../../../lib/broadcastSend";

interface Body { broadcastId?: number }

// 即時配信（スタッフのみ）。予約は cron から runBroadcast が呼ばれる。
export async function POST(request: Request) {
  try {
    await requireOps(request);

    const { broadcastId } = (await request.json()) as Body;
    if (broadcastId == null) throw new HttpError(400, "broadcastId は必須です");

    const result = await runBroadcast(broadcastId);
    if (!result.ok) throw new HttpError(500, result.error ?? "配信に失敗しました");
    return NextResponse.json({ success: true, recipientCount: result.recipientCount });
  } catch (err) {
    return errorResponse(err);
  }
}
