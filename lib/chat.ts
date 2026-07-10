// ============================================================
// チャット データアクセス（社内スタッフ ↔ メンバー〈顧客〉）
//   会話は「顧客1人＝1スレッド」。取得/送信/既読/検索のヘルパー。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type {
  Member, ChatSide, ChatMessage, ChatAttachment, ChatThread,
} from "./models";
import { uploadAttachment } from "./chatStorage";

// ── 変換 ──────────────────────────────────────────────────────
const toAttachment = (r: Tables<"chat_attachments">): ChatAttachment => ({
  id: r.id,
  messageId: r.message_id,
  fileName: r.file_name,
  storagePath: r.storage_path,
  mimeType: r.mime_type ?? "",
  sizeBytes: r.size_bytes ?? 0,
  createdAt: r.created_at ?? "",
});

const toMessage = (
  r: Tables<"chat_messages">,
  attachments: ChatAttachment[] = []
): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderMemberId: r.sender_member_id,
  side: (r.sender_side === "staff" ? "staff" : "member") as ChatSide,
  body: r.body ?? "",
  createdAt: r.created_at ?? "",
  attachments,
});

// ── 一覧（スタッフ用） ─────────────────────────────────────────
/** 全会話＋顧客情報＋未読数。新着（未読）→最終更新の順で並べる。 */
export async function fetchThreads(members: Member[]): Promise<ChatThread[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));

  const { data: convs, error } = await supabase
    .from("chat_conversations")
    .select("*");
  if (error || !convs) return [];

  // 顧客発メッセージの時刻だけ取得して未読を集計
  const { data: memberMsgs } = await supabase
    .from("chat_messages")
    .select("conversation_id, created_at, sender_side")
    .eq("sender_side", "member");

  const threads: ChatThread[] = convs.map((c) => {
    const readAt = c.staff_last_read_at ? Date.parse(c.staff_last_read_at) : 0;
    const unread = (memberMsgs ?? []).filter(
      (m) => m.conversation_id === c.id && Date.parse(m.created_at ?? "") > readAt
    ).length;
    const member = memberById.get(c.member_id);
    return {
      conversationId: c.id,
      member: member ?? {
        id: c.member_id, name: "（不明なメンバー）", role: "メンバー",
        userId: null, email: "", company: "", chatId: "", isDeleted: false,
      },
      assignedTo: c.assigned_to,
      lastMessageAt: c.last_message_at ?? c.created_at ?? "",
      lastSnip: c.last_message_snip ?? "",
      staffLastReadAt: c.staff_last_read_at,
      unread,
    };
  });

  threads.sort((a, b) =>
    (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) ||
    b.unread - a.unread ||
    Date.parse(b.lastMessageAt || "0") - Date.parse(a.lastMessageAt || "0")
  );
  return threads;
}

// ── メッセージ取得 ────────────────────────────────────────────
export async function fetchMessages(conversationId: number): Promise<ChatMessage[]> {
  const { data: msgs, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error || !msgs) return [];

  const ids = msgs.map((m) => m.id);
  let attByMsg = new Map<number, ChatAttachment[]>();
  if (ids.length > 0) {
    const { data: atts } = await supabase
      .from("chat_attachments")
      .select("*")
      .in("message_id", ids);
    attByMsg = (atts ?? []).reduce((acc, a) => {
      const arr = acc.get(a.message_id) ?? [];
      arr.push(toAttachment(a));
      acc.set(a.message_id, arr);
      return acc;
    }, new Map<number, ChatAttachment[]>());
  }
  return msgs.map((m) => toMessage(m, attByMsg.get(m.id) ?? []));
}

// ── 送信 ──────────────────────────────────────────────────────
export interface SendArgs {
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  files?: File[];
}

/** メッセージ＋添付を保存し、会話のメタ（最終更新・プレビュー）を更新 */
export async function sendMessage(args: SendArgs): Promise<ChatMessage | null> {
  const { conversationId, senderMemberId, side, body, files = [] } = args;
  const { data: msg, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_member_id: senderMemberId,
      sender_side: side,
      body,
    })
    .select()
    .single();
  if (error || !msg) return null;

  const attachments: ChatAttachment[] = [];
  for (const file of files) {
    try {
      const up = await uploadAttachment(conversationId, msg.id, file);
      const { data: att } = await supabase
        .from("chat_attachments")
        .insert({
          message_id: msg.id,
          file_name: up.fileName,
          storage_path: up.storagePath,
          mime_type: up.mimeType,
          size_bytes: up.sizeBytes,
        })
        .select()
        .single();
      if (att) attachments.push(toAttachment(att));
    } catch (e) {
      console.error("添付アップロード失敗:", e);
    }
  }

  const snip = body.trim() || (files.length > 0 ? `📎 ${files[0].name}` : "");
  await supabase
    .from("chat_conversations")
    .update({ last_message_at: new Date().toISOString(), last_message_snip: snip })
    .eq("id", conversationId);

  return toMessage(msg, attachments);
}

// ── 既読 ──────────────────────────────────────────────────────
/** スタッフ側の既読位置を now に（未読通数を0に） */
export async function markStaffRead(conversationId: number): Promise<void> {
  await supabase
    .from("chat_conversations")
    .update({ staff_last_read_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/** メンバー側の既読位置を now に */
export async function markMemberRead(conversationId: number): Promise<void> {
  await supabase
    .from("chat_conversations")
    .update({ member_last_read_at: new Date().toISOString() })
    .eq("id", conversationId);
}

// ── 会話の取得/作成（メンバー用） ─────────────────────────────
/** 自分（顧客）の会話を取得。無ければ作成して conversationId を返す。 */
export async function getOrCreateMyConversation(myMemberId: number): Promise<number | null> {
  const { data: existing } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("member_id", myMemberId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("chat_conversations")
    .insert({ member_id: myMemberId })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

export { toMessage };
