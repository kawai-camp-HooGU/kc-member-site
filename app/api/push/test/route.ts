import { NextResponse } from "next/server";
import { sendToMembers } from "../../../../lib/pushServer";

// テスト送信：自分（memberId）の登録端末へプッシュを1通送る
export async function POST(req: Request) {
  try {
    const { memberId } = (await req.json()) as { memberId?: number };
    if (!memberId) return NextResponse.json({ error: "memberId が必要です" }, { status: 400 });

    const sent = await sendToMembers([memberId], {
      title: "テスト通知",
      body: "通知は正常に届いています。",
      url: "/",
      tag: "test",
    }, "test");

    if (sent === 0) {
      return NextResponse.json(
        { error: "送信先の端末がありません（この端末を有効にする を押してください）", sent: 0 },
        { status: 400 }
      );
    }
    return NextResponse.json({ sent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "送信に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
