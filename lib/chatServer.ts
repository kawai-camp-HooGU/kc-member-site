// ============================================================
// チャット送信（サーバー専用・service role）
//
//   一斉配信・シナリオ配信・自動アクションからチャットに投稿する共通経路。
//   ここを通すことで、以下が必ず揃う。
//     ・origin（broadcast / scenario / action）が記録される
//       → 運営画面で「人が書いた返信」と「自動配信」を色で見分けられる
//     ・本文中のURLが chat_links に登録される
//       → 会員が踏んだかどうかを運営画面に出せる
//     ・会話のメタ（最終更新・プレビュー）が更新される
//
//   ⚠️ チャットに流す本文は **trackify しない**（メールとは別扱い）。
//      メールは broadcast_links の計測URLに置換するが、チャットは chat_links で
//      計測するため、二重にリダイレクタを噛ませない。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { extractUrls } from "./chat";
import type { ChatOrigin } from "./models";

/** 会員の会話を取得（無ければ作る） */
export async function ensureConversation(memberId: number): Promise<number | null> {
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations").select("id").eq("member_id", memberId).maybeSingle();
  if (conv) return conv.id;

  const { data: created } = await supabaseAdmin
    .from("chat_conversations").insert({ member_id: memberId }).select("id").single();
  return created?.id ?? null;
}

/**
 * チャットに1通投稿する。
 * @returns メッセージID（失敗時 null）
 */
export async function postChatMessage(
  conversationId: number,
  body: string,
  origin: Exclude<ChatOrigin, "member">,
): Promise<number | null> {
  const { data: msg, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({ conversation_id: conversationId, sender_member_id: null, sender_side: "staff", body, origin })
    .select("id")
    .single();
  if (error || !msg) {
    console.error("チャット投稿に失敗:", error?.message);
    return null;
  }

  // 本文中のURL（訪問計測用）。失敗しても投稿自体は成功させる。
  const urls = extractUrls(body);
  if (urls.length) {
    const { error: linkErr } = await supabaseAdmin
      .from("chat_links").insert(urls.map((url) => ({ message_id: msg.id, url })));
    if (linkErr) console.warn("チャットのリンク登録に失敗:", linkErr.message);
  }

  const snip = body.length > 60 ? `${body.slice(0, 60)}…` : body;
  await supabaseAdmin.from("chat_conversations")
    .update({ last_message_at: new Date().toISOString(), last_message_snip: snip })
    .eq("id", conversationId);

  return msg.id;
}
