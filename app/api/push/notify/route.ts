import { NextResponse } from "next/server";
import { sendToMembers, resolveChatTargets, resolveNewsTargets } from "../../../../lib/pushServer";

// 通知トリガー
//   chat: { kind:"chat", conversationId, senderSide, senderMemberId, senderName?, body? }
//   news: { kind:"news", newsId }
export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as {
      kind?: string;
      conversationId?: number;
      senderSide?: string;
      senderMemberId?: number | null;
      senderName?: string;
      body?: string;
      newsId?: number;
    };

    if (payload.kind === "chat") {
      const { conversationId, senderSide, senderMemberId } = payload;
      if (!conversationId || !senderSide) {
        return NextResponse.json({ error: "conversationId / senderSide が必要です" }, { status: 400 });
      }
      const targets = await resolveChatTargets(conversationId, senderSide, senderMemberId ?? null);
      const preview = (payload.body ?? "").replace(/\s+/g, " ").slice(0, 60);
      const sent = await sendToMembers(targets, {
        title: "新しいメッセージ",
        body: payload.senderName ? `${payload.senderName}：${preview}` : (preview || "メッセージが届きました"),
        url: "/",
        tag: `chat-${conversationId}`,
      }, "chat");
      return NextResponse.json({ sent, targets: targets.length });
    }

    if (payload.kind === "news") {
      if (!payload.newsId) return NextResponse.json({ error: "newsId が必要です" }, { status: 400 });
      const resolved = await resolveNewsTargets(payload.newsId);
      if (!resolved) return NextResponse.json({ sent: 0, targets: 0 });
      const sent = await sendToMembers(resolved.memberIds, {
        title: "新しいお知らせ",
        body: resolved.title,
        url: "/",
        tag: `news-${payload.newsId}`,
      }, "news");
      return NextResponse.json({ sent, targets: resolved.memberIds.length });
    }

    return NextResponse.json({ error: "kind が不正です" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "通知の送信に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
