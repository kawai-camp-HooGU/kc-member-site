// ============================================================
// LINE名寄せ 運営操作（POST）：照合実行 / 手動連携 / 解除 / 連携フォーム送付
//   運営のみ（requireOps）。可否は権限マスタ（line_friends）で画面側が出し分ける。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { pushText } from "../../../../lib/lineClient";
import { getFriendById } from "../../../../lib/lineServer";
import { getAccessToken } from "../../../../lib/lineAccountsServer";
import { runMatch, manualLink, unlink, ensureLinkToken, buildLinkQueue } from "../../../../lib/lineLinkServer";

interface Body {
  action?: "match" | "manual" | "unlink" | "send-form" | "queue";
  friendId?: number;
  memberId?: number;
  accountId?: number | null;
  /** send-form：案内メッセージに添える一言（任意） */
  note?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as Body;

    // 名寄せキュー（友だち横断・friendId 不要）
    if (b.action === "queue") {
      const items = await buildLinkQueue(b.accountId ?? null);
      return NextResponse.json({ ok: true, items });
    }

    if (b.friendId == null) throw new HttpError(400, "friendId は必須です");

    if (b.action === "match") {
      const result = await runMatch(b.friendId, "auto");
      return NextResponse.json({ ok: true, result });
    }

    if (b.action === "manual") {
      if (b.memberId == null) throw new HttpError(400, "memberId は必須です");
      const r = await manualLink(b.friendId, b.memberId, me.memberId);
      if (!r.ok) throw new HttpError(409, r.error ?? "連携に失敗しました");
      return NextResponse.json({ ok: true });
    }

    if (b.action === "unlink") {
      const r = await unlink(b.friendId, me.memberId);
      if (!r.ok) throw new HttpError(409, r.error ?? "解除に失敗しました");
      return NextResponse.json({ ok: true });
    }

    if (b.action === "send-form") {
      const friend = await getFriendById(b.friendId);
      if (!friend) throw new HttpError(404, "友だちが見つかりません");
      if (friend.status !== "friend") throw new HttpError(409, "ブロック等のため送信できません");
      if (friend.account_id == null) throw new HttpError(409, "アカウントが特定できません");
      const token = await ensureLinkToken(b.friendId);
      if (!token) throw new HttpError(500, "トークンの発行に失敗しました");
      const accessToken = await getAccessToken(friend.account_id);
      if (!accessToken) throw new HttpError(409, "アカウントの認証情報が未登録です");
      const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/line-link/${token}`;
      const msg =
        (b.note?.trim() ? `${b.note.trim()}\n\n` : "") +
        `会員情報の連携のお願いです。\n下記フォームからお名前・メール・電話番号をご登録ください。\n${url}`;
      await pushText(accessToken, friend.line_user_id, msg);
      return NextResponse.json({ ok: true, url });
    }

    throw new HttpError(400, "action が不正です");
  } catch (err) {
    return errorResponse(err);
  }
}
