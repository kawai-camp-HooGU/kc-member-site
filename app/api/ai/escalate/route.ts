// ============================================================
// ① 事務局へ引き継ぎ（AI相談 → 事務局チャット）
//    ※ 実際の送信は「メンバー本人が送信ボタンを押す」設計のため、
//       このAPIは呼ばれない運用も可能。
//       ここでは「引き継ぎ済み」の関連付けだけを行う（監査用）。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireMember, errorResponse, HttpError } from "../../../../lib/authz";
import { logEvent } from "../../../../lib/ai/claude";

interface Body { aiConversationId?: number }

export async function POST(request: Request) {
  try {
    const me = await requireMember(request);
    const memberId = me.memberId as number;
    const { aiConversationId } = (await request.json()) as Body;
    if (aiConversationId == null) throw new HttpError(400, "aiConversationId は必須です");

    // 自分のスレッドか確認
    const { data: own } = await supabaseAdmin
      .from("ai_conversations")
      .select("id")
      .eq("id", aiConversationId)
      .eq("member_id", memberId)
      .maybeSingle();
    if (!own) throw new HttpError(403, "この相談スレッドを操作する権限がありません");

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("id")
      .eq("member_id", memberId)
      .maybeSingle();

    if (conv) {
      await supabaseAdmin
        .from("ai_conversations")
        .update({ escalated_conversation_id: conv.id })
        .eq("id", aiConversationId);
    }

    await logEvent("escalate", memberId, `ai_conv:${aiConversationId}`);
    return NextResponse.json({ conversationId: conv?.id ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
