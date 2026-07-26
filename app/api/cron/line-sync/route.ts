// ============================================================
// LINE 遅延処理の cron（GET）／全アカウント横断
//   Webhookを軽く保つため、①受信メディアの退避 ②表示名・アイコンの後追い取得
//   を account 単位でまとめて処理する。Vercel Cron から5分間隔（vercel.json）。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { syncPendingMedia, syncFriendProfiles } from "../../../../lib/lineServer";
import { listActiveAccountIds, getAccessToken } from "../../../../lib/lineAccountsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    requireCron(request); // fail-closed（CRON_SECRET 未設定なら誰も叩けない）
    const ids = await listActiveAccountIds();
    let media = 0, profiles = 0;
    for (const id of ids) {
      const token = await getAccessToken(id);
      if (!token) continue;
      media += await syncPendingMedia(id, token, 50);
      profiles += await syncFriendProfiles(id, token, 50);
    }
    return NextResponse.json({ ran: new Date().toISOString(), accounts: ids.length, media, profiles });
  } catch (err) {
    return errorResponse(err);
  }
}
