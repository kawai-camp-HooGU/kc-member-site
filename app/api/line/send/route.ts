// ============================================================
// LINE 送信（POST）：スタッフの手動返信（Push）
//   運営のみ。友だちの所属アカウントのアクセストークンで送信し、
//   成功してから DB 保存する（幻の送信履歴を残さない）。
//   send_kind='push' を必ず記録（Phase4 の通数集計の土台）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { pushText } from "../../../../lib/lineClient";
import { getFriendById, insertOutMessage } from "../../../../lib/lineServer";
import { getAccessToken } from "../../../../lib/lineAccountsServer";

interface SendBody { friendId?: number; text?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as SendBody;

    const friendId = b.friendId;
    const text = (b.text ?? "").trim();
    if (friendId == null) throw new HttpError(400, "friendId は必須です");
    if (!text) throw new HttpError(400, "本文は必須です");

    const friend = await getFriendById(friendId);
    if (!friend) throw new HttpError(404, "友だちが見つかりません");
    if (friend.status !== "friend") throw new HttpError(409, "ブロック等のため送信できません");
    if (friend.account_id == null) throw new HttpError(409, "この友だちのアカウントが特定できません");

    const accessToken = await getAccessToken(friend.account_id);
    if (!accessToken) throw new HttpError(409, "アカウントの認証情報が未登録です");

    // 先に LINE 送信（失敗したら 5xx を返し、DBには残さない）
    await pushText(accessToken, friend.line_user_id, text);

    const msg = await insertOutMessage(friend.account_id, friendId, text, me.memberId, "push");
    if (!msg) throw new HttpError(500, "送信は成功しましたが保存に失敗しました");

    return NextResponse.json({ ok: true, id: msg.id });
  } catch (err) {
    return errorResponse(err);
  }
}
