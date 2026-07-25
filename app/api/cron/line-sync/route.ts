// ============================================================
// LINE 遅延処理の cron（GET）
//   Webhookを軽く保つため、①受信メディアの退避 ②表示名・アイコンの後追い取得
//   をここに集約する。Vercel Cron から5分間隔で実行（vercel.json）。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { syncPendingMedia, syncFriendProfiles } from "../../../../lib/lineServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    requireCron(request); // fail-closed（CRON_SECRET 未設定なら誰も叩けない）
    const media = await syncPendingMedia(50);
    const profiles = await syncFriendProfiles(50);
    return NextResponse.json({ ran: new Date().toISOString(), media, profiles });
  } catch (err) {
    return errorResponse(err);
  }
}
