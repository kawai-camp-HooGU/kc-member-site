import { NextResponse } from "next/server";
import { sendToMembers } from "../../../../lib/pushServer";
import { requireMember, errorResponse, HttpError } from "../../../../lib/authz";

// テスト送信：自分の登録端末へプッシュを1通送る
//
// ⚠️ Phase 0 で認可を追加：
//   以前は未認証・memberId 指定で叩けたため、第三者が任意の会員へ
//   プッシュを送りつけられた。送信先は必ずトークン上の本人に固定する。
export async function POST(req: Request) {
  try {
    const caller = await requireMember(req);

    const sent = await sendToMembers([caller.memberId as number], {
      title: "テスト通知",
      body: "通知は正常に届いています。",
      url: "/",
      tag: "test",
    }, "test");

    if (sent === 0) {
      throw new HttpError(400, "送信先の端末がありません（この端末を有効にする を押してください）");
    }
    return NextResponse.json({ sent });
  } catch (err) {
    return errorResponse(err);
  }
}
