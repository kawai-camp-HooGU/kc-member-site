import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";

// 初回ログイン時、運営が設定したウェルカムメッセージを（流入経路で分岐して）1回だけ送信する。
// メンバー本人のトークンで呼び出す。冪等（welcomed_at を先に確保して二重送信を防止）。
//
// ⚠️ Phase 3：経路別の文面は app_settings.welcome_routes(JSON) から
//    welcome_messages テーブル（source_id → message）へ移行済み。
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    }

    // 本人のメンバー行
    const { data: member } = await supabaseAdmin
      .from("members")
      .select("id, role, source_id, welcomed_at")
      .eq("user_id", userData.user.id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (!member) {
      return NextResponse.json({ sent: false, reason: "no_member" });
    }
    // 送信対象は顧客ロール（メンバー / 外部）のみ
    if (member.role !== "メンバー" && member.role !== "外部") {
      return NextResponse.json({ sent: false, reason: "not_customer" });
    }
    if (member.welcomed_at) {
      return NextResponse.json({ sent: false, reason: "already" });
    }

    // 設定を取得
    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("welcome_enabled, welcome_default")
      .eq("id", 1)
      .maybeSingle();
    if (!settings?.welcome_enabled) {
      return NextResponse.json({ sent: false, reason: "disabled" });
    }

    // 流入経路で分岐 → 文面決定（Phase 3：welcome_messages を参照）
    //   経路別の文面が無ければ既定文面にフォールバックする。
    let routeMessage = "";
    if (member.source_id != null) {
      const { data: wm } = await supabaseAdmin
        .from("welcome_messages")
        .select("message")
        .eq("source_id", member.source_id)
        .maybeSingle();
      routeMessage = (wm?.message ?? "").trim();
    }
    const message = (routeMessage || settings.welcome_default || "").trim();
    if (!message) {
      return NextResponse.json({ sent: false, reason: "no_message" });
    }

    // 二重送信防止：welcomed_at が null の場合のみ now を確保
    const nowIso = new Date().toISOString();
    const { data: claimed } = await supabaseAdmin
      .from("members")
      .update({ welcomed_at: nowIso })
      .eq("id", member.id)
      .is("welcomed_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ sent: false, reason: "already" });
    }

    try {
      // 会話を取得（無ければ作成）
      let conversationId: number;
      const { data: conv } = await supabaseAdmin
        .from("chat_conversations")
        .select("id")
        .eq("member_id", member.id)
        .maybeSingle();
      if (conv) {
        conversationId = conv.id;
      } else {
        const { data: created, error: convErr } = await supabaseAdmin
          .from("chat_conversations")
          .insert({ member_id: member.id })
          .select("id")
          .single();
        if (convErr || !created) throw new Error(convErr?.message ?? "会話の作成に失敗しました");
        conversationId = created.id;
      }

      // 運営（事務局）からのメッセージとして挿入
      const { error: msgErr } = await supabaseAdmin
        .from("chat_messages")
        .insert({ conversation_id: conversationId, sender_member_id: null, sender_side: "staff", body: message });
      if (msgErr) throw new Error(msgErr.message);

      // 会話メタを更新（一覧のプレビュー・並び用）
      const snip = message.length > 60 ? `${message.slice(0, 60)}…` : message;
      await supabaseAdmin
        .from("chat_conversations")
        .update({ last_message_at: nowIso, last_message_snip: snip })
        .eq("id", conversationId);

      return NextResponse.json({ sent: true });
    } catch (e) {
      // 送信に失敗したら welcomed_at を戻して次回再試行できるようにする
      await supabaseAdmin.from("members").update({ welcomed_at: null }).eq("id", member.id);
      throw e;
    }
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
