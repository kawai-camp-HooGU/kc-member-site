// ============================================================
// チャット データアクセス（社内スタッフ ↔ メンバー〈顧客〉）
//   会話は「顧客1人＝1スレッド」。取得/送信/既読/検索のヘルパー。
// ============================================================
import { supabase } from "./supabase";
import { firePushNotify } from "./push";
import type { Tables } from "./database.types";
import type {
  Member, ChatSide, ChatMessage, ChatAttachment, ChatThread, ChatOrigin, ChatLink,
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

const ORIGINS: ChatOrigin[] = ["member", "staff", "broadcast", "scenario", "action"];
const toOrigin = (v: string | null | undefined, side: ChatSide): ChatOrigin =>
  (ORIGINS as string[]).includes(v ?? "") ? (v as ChatOrigin) : (side === "staff" ? "staff" : "member");

const toLink = (r: Tables<"chat_links">): ChatLink => ({
  id: r.id,
  messageId: r.message_id,
  url: r.url,
  clickedAt: r.clicked_at ?? "",
  lastClickAt: r.last_click_at ?? "",
  clickCount: r.click_count ?? 0,
});

const toMessage = (
  r: Tables<"chat_messages">,
  attachments: ChatAttachment[] = [],
  links: ChatLink[] = [],
): ChatMessage => {
  const side = (r.sender_side === "staff" ? "staff" : "member") as ChatSide;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderMemberId: r.sender_member_id,
    side,
    body: r.body ?? "",
    createdAt: r.created_at ?? "",
    attachments,
    origin: toOrigin(r.origin, side),
    replyToId: r.reply_to_id ?? null,
    links,
  };
};

// ── 本文中のURL ───────────────────────────────────────────────
/**
 * 本文からURLを抜き出す（重複は除く）。
 *   末尾の句読点・閉じ括弧は URL に含めない（日本語文中に貼られることが多いため）。
 */
export function extractUrls(body: string): string[] {
  const re = /https?:\/\/[^\s<>"'）)、。]+/g;
  const found = (body.match(re) ?? []).map((u) => u.replace(/[.,]+$/, ""));
  return [...new Set(found)];
}

/** クリック計測用のURL（このURLを踏ませると訪問が記録される） */
export const chatClickUrl = (linkId: number): string => `/api/chat/click?l=${linkId}`;

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

  // 最新メッセージ順（安定）。未読はバッジで示す。
  // 以前は「未読優先」だったため、確認済にすると対象スレッドが下へ飛んでいた（3-6修正）。
  threads.sort((a, b) =>
    Date.parse(b.lastMessageAt || "0") - Date.parse(a.lastMessageAt || "0")
  );
  return threads;
}

// ── 未読総数（サイドバー用） ──────────────────────────────────
/**
 * サイドバーに出す「未確認メッセージの総数」を返す。
 * - スタッフ（管理者/リーダー）: 全会話の顧客発・未読メッセージ合計
 * - メンバー（顧客）: 自分の会話の事務局発・未読メッセージ数
 */
export async function fetchUnreadTotal(
  isStaff: boolean,
  myMemberId: number | null,
): Promise<number> {
  if (isStaff) {
    const { data: convs } = await supabase
      .from("chat_conversations")
      .select("id, staff_last_read_at");
    if (!convs || convs.length === 0) return 0;

    const { data: memberMsgs } = await supabase
      .from("chat_messages")
      .select("conversation_id, created_at")
      .eq("sender_side", "member");
    if (!memberMsgs) return 0;

    const readByConv = new Map(
      convs.map((c) => [c.id, c.staff_last_read_at ? Date.parse(c.staff_last_read_at) : 0]),
    );
    return memberMsgs.reduce((sum, m) => {
      const readAt = readByConv.get(m.conversation_id);
      if (readAt === undefined) return sum;
      return Date.parse(m.created_at ?? "") > readAt ? sum + 1 : sum;
    }, 0);
  }

  if (myMemberId == null) return 0;
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id, member_last_read_at")
    .eq("member_id", myMemberId)
    .maybeSingle();
  if (!conv) return 0;

  const readAt = conv.member_last_read_at ? Date.parse(conv.member_last_read_at) : 0;
  const { data: staffMsgs } = await supabase
    .from("chat_messages")
    .select("created_at")
    .eq("conversation_id", conv.id)
    .eq("sender_side", "staff");
  return (staffMsgs ?? []).filter((m) => Date.parse(m.created_at ?? "") > readAt).length;
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
  let linkByMsg = new Map<number, ChatLink[]>();
  if (ids.length > 0) {
    const [{ data: atts }, { data: links }] = await Promise.all([
      supabase.from("chat_attachments").select("*").in("message_id", ids),
      supabase.from("chat_links").select("*").in("message_id", ids),
    ]);
    attByMsg = (atts ?? []).reduce((acc, a) => {
      const arr = acc.get(a.message_id) ?? [];
      arr.push(toAttachment(a));
      acc.set(a.message_id, arr);
      return acc;
    }, new Map<number, ChatAttachment[]>());
    linkByMsg = (links ?? []).reduce((acc, l) => {
      const arr = acc.get(l.message_id) ?? [];
      arr.push(toLink(l));
      acc.set(l.message_id, arr);
      return acc;
    }, new Map<number, ChatLink[]>());
  }
  return msgs.map((m) => toMessage(m, attByMsg.get(m.id) ?? [], linkByMsg.get(m.id) ?? []));
}

// ── 送信 ──────────────────────────────────────────────────────
export interface SendArgs {
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  files?: File[];
  /** 通知本文に出す送信者名（任意） */
  senderName?: string;
  /** 引用返信の元メッセージID */
  replyToId?: number | null;
}

/** メッセージ＋添付を保存し、会話のメタ（最終更新・プレビュー）を更新 */
export async function sendMessage(args: SendArgs): Promise<ChatMessage | null> {
  const { conversationId, senderMemberId, side, body, files = [], replyToId = null } = args;
  const { data: msg, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_member_id: senderMemberId,
      sender_side: side,
      body,
      // 手で書いた返信＝staff。配信系はサーバー側（broadcastSend / scenarioRun）が自分で入れる。
      origin: side === "staff" ? "staff" : "member",
      reply_to_id: replyToId,
    })
    .select()
    .single();
  if (error || !msg) return null;

  // ── 本文中のURLを登録（訪問計測用）──
  //   運営が送ったメッセージだけ計測する。会員の発言のURLを追う必要はない。
  //   ⚠️ 失敗しても送信自体は成功させる（計測は本流ではない）。
  const links: ChatLink[] = [];
  if (side === "staff") {
    const urls = extractUrls(body);
    if (urls.length) {
      const { data: rows } = await supabase
        .from("chat_links")
        .insert(urls.map((url) => ({ message_id: msg.id, url })))
        .select();
      (rows ?? []).forEach((r) => links.push(toLink(r)));
    }
  }

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

  // プッシュ通知（受信側へ）。失敗しても送信処理は止めない。
  // 送信者（senderSide / senderMemberId / senderName）はサーバー側で
  // アクセストークンから確定するため、クライアントからは送らない（なりすまし防止）。
  firePushNotify({
    kind: "chat",
    conversationId,
    body: snip,
  });

  return toMessage(msg, attachments, links);
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
