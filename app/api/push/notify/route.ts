import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { sendToMembers, resolveChatTargets, resolveNewsTargets } from "../../../../lib/pushServer";
import { requireMember, errorResponse, HttpError } from "../../../../lib/authz";

// 通知トリガー
//   chat: { kind:"chat", conversationId, body? }
//   news: { kind:"news", newsId }
//
// ⚠️ Phase 0 で認可を追加：
//   以前は未認証で叩けたため、第三者が任意の送信者名・任意の本文で
//   会員の端末へプッシュ通知を送れる状態だった（フィッシングの経路になり得る）。
//   ・chat … ログイン済みメンバーのみ。送信者はトークンから確定させ、申告値は使わない。
//   ・news … 運営（管理者・オペレーター）のみ。
export async function POST(req: Request) {
  try {
    const caller = await requireMember(req);

    const payload = (await req.json()) as {
      kind?: string;
      conversationId?: number;
      body?: string;
      newsId?: number;
    };

    if (payload.kind === "chat") {
      const { conversationId } = payload;
      if (!conversationId) throw new HttpError(400, "conversationId が必要です");

      // 送信者・送信者名はクライアントの申告ではなくトークンから確定（なりすまし防止）
      const senderMemberId = caller.memberId;
      const senderSide = caller.isOps ? "staff" : "member";

      const { data: me } = await supabaseAdmin
        .from("members").select("name").eq("id", senderMemberId as number).maybeSingle();
      const senderName = me?.name ?? "";

      const targets = await resolveChatTargets(conversationId, senderSide, senderMemberId);
      const preview = (payload.body ?? "").replace(/\s+/g, " ").slice(0, 60);
      const sent = await sendToMembers(targets, {
        title: "新しいメッセージ",
        body: senderName ? `${senderName}：${preview}` : (preview || "メッセージが届きました"),
        url: "/",
        tag: `chat-${conversationId}`,
      }, "chat");
      return NextResponse.json({ sent, targets: targets.length });
    }

    if (payload.kind === "news") {
      if (!caller.isOps) throw new HttpError(403, "この操作の権限がありません");
      if (!payload.newsId) throw new HttpError(400, "newsId が必要です");

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

    throw new HttpError(400, "kind が不正です");
  } catch (err) {
    return errorResponse(err);
  }
}
