// ============================================================
// LINE連携 サーバー処理（service_role / サーバー専用）
//   ・Webhookイベントの保存（friend upsert・message insert・自動あいさつ）
//   ・cron 向けヘルパー（メディア退避・プロフィール後追い）
//   ⚠️ ここは supabaseAdmin（RLS迂回）を使う。クライアントから import しないこと。
//   ⚠️ 冪等：line_messages.line_message_id UNIQUE ＋ ignoreDuplicates。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import type { Json } from "./database.types";
import { getContent, getProfile, replyText } from "./lineClient";
import { errMessage } from "./errors";

const MEDIA_BUCKET = "line-media";

// ── Webhookイベントの最小型（扱うものだけ）────────────────────
interface LineSource { type: string; userId?: string }
interface LineDeliveryContext { isRedelivery?: boolean }
interface LineMessageContent {
  id: string;
  type: string;                 // text / image / video / audio / file / sticker / location ...
  text?: string;
  fileName?: string;
  packageId?: string;
  stickerId?: string;
  address?: string;
  title?: string;
}
export interface LineWebhookEvent {
  type: string;                 // message / follow / unfollow / postback ...
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessageContent;
  deliveryContext?: LineDeliveryContext;
}
export interface LineWebhookBody { destination?: string; events?: LineWebhookEvent[] }

// ── ユーティリティ ────────────────────────────────────────────
const snip = (s: string): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};
const tsToIso = (ts?: number): string =>
  ts && Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();

/** メディア系メッセージの本文ラベルと種別。 */
function describeMessage(m: LineMessageContent): { type: string; body: string; hasMedia: boolean } {
  switch (m.type) {
    case "text":     return { type: "text",     body: m.text ?? "",             hasMedia: false };
    case "image":    return { type: "image",    body: "画像を受信",             hasMedia: true };
    case "video":    return { type: "video",    body: "動画を受信",             hasMedia: true };
    case "audio":    return { type: "audio",    body: "音声を受信",             hasMedia: true };
    case "file":     return { type: "file",     body: m.fileName ?? "ファイルを受信", hasMedia: true };
    case "sticker":  return { type: "sticker",  body: "スタンプを受信",         hasMedia: false };
    case "location": return { type: "location", body: m.title ?? m.address ?? "位置情報を受信", hasMedia: false };
    default:         return { type: "other",    body: `${m.type} を受信`,        hasMedia: false };
  }
}

// ── friend upsert ─────────────────────────────────────────────
/** userId で友だちを取得（無ければ作成）。作成/更新後の行を返す。 */
async function upsertFriend(
  userId: string,
  patch: Partial<{ status: string; followed_at: string; unfollowed_at: string }> = {}
): Promise<{ id: number; source_id: number | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("line_friends")
    .upsert({ line_user_id: userId, ...patch }, { onConflict: "line_user_id", ignoreDuplicates: false })
    .select("id, source_id")
    .single();
  if (error || !data) {
    console.error("upsertFriend error:", error?.message);
    return null;
  }
  return data;
}

async function touchFriend(friendId: number, lastSnip: string, at: string): Promise<void> {
  await supabaseAdmin
    .from("line_friends")
    .update({ last_message_at: at, last_message_snip: lastSnip })
    .eq("id", friendId);
}

// ── あいさつ選択（source_id 一致 → 既定） ─────────────────────
async function pickGreeting(sourceId: number | null): Promise<string | null> {
  // 経路一致（Phase1では source_id は基本 null）
  if (sourceId != null) {
    const { data } = await supabaseAdmin
      .from("line_greetings")
      .select("message, is_enabled")
      .eq("source_id", sourceId)
      .maybeSingle();
    if (data?.is_enabled && data.message) return data.message;
  }
  // 既定行
  const { data: def } = await supabaseAdmin
    .from("line_greetings")
    .select("message, is_enabled")
    .is("source_id", null)
    .maybeSingle();
  if (def?.is_enabled && def.message) return def.message;
  return null;
}

// ── イベント処理 ──────────────────────────────────────────────
export async function handleLineEvent(ev: LineWebhookEvent): Promise<void> {
  const userId = ev.source?.userId;
  if (!userId) return; // group/room 等 userId が無いソースはPhase1対象外

  if (ev.type === "message" && ev.message) {
    const friend = await upsertFriend(userId, { status: "friend" });
    if (!friend) return;
    const d = describeMessage(ev.message);
    const at = tsToIso(ev.timestamp);
    const { error } = await supabaseAdmin
      .from("line_messages")
      .upsert(
        {
          friend_id: friend.id,
          line_message_id: ev.message.id,
          direction: "in",
          msg_type: d.type,
          body: d.body,
          media_status: d.hasMedia ? "pending" : "none",
          reply_token: ev.replyToken ?? null,
          raw: ev as unknown as Json,
          created_at: at,
        },
        { onConflict: "line_message_id", ignoreDuplicates: true }
      );
    if (error) console.error("insert in-message error:", error.message);
    await touchFriend(friend.id, snip(d.body), at);
    return;
  }

  if (ev.type === "follow") {
    // 再送（isRedelivery）では二重あいさつしない
    const isRedelivery = ev.deliveryContext?.isRedelivery === true;
    const friend = await upsertFriend(userId, { status: "friend", followed_at: tsToIso(ev.timestamp) });
    if (!friend) return;
    if (isRedelivery || !ev.replyToken) return;
    try {
      const greeting = await pickGreeting(friend.source_id);
      if (greeting) {
        await replyText(ev.replyToken, greeting);
        await supabaseAdmin.from("line_messages").insert({
          friend_id: friend.id,
          direction: "out",
          msg_type: "text",
          body: greeting,
          sent_by: null,
          send_kind: "reply",
          created_at: tsToIso(ev.timestamp),
        });
      }
    } catch (e) {
      console.error("follow greeting error:", errMessage(e));
    }
    return;
  }

  if (ev.type === "unfollow") {
    await upsertFriend(userId, { status: "unfollowed", unfollowed_at: tsToIso(ev.timestamp) });
    return;
  }

  // postback 等：Phase1では raw を残すだけ（friendに紐づけて記録）
  const friend = await upsertFriend(userId);
  if (friend) {
    await supabaseAdmin.from("line_messages").insert({
      friend_id: friend.id,
      direction: "in",
      msg_type: "other",
      body: `${ev.type} イベント`,
      media_status: "none",
      raw: ev as unknown as Json,
      created_at: tsToIso(ev.timestamp),
    });
  }
}

// ── 送信（Push後の保存。API Route から呼ぶ）───────────────────
export async function getFriendById(
  friendId: number
): Promise<{ id: number; line_user_id: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id, status")
    .eq("id", friendId)
    .maybeSingle();
  return data ?? null;
}

export async function insertOutMessage(
  friendId: number,
  text: string,
  sentBy: number | null,
  sendKind: "push" | "reply"
): Promise<{ id: number } | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("line_messages")
    .insert({
      friend_id: friendId,
      direction: "out",
      msg_type: "text",
      body: text,
      sent_by: sentBy,
      send_kind: sendKind,
      created_at: now,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("insertOutMessage error:", error?.message);
    return null;
  }
  await touchFriend(friendId, snip(text), now);
  return data;
}

// ── メディア署名URL（API Route から呼ぶ）──────────────────────
export async function createLineMediaSignedUrl(messageId: number): Promise<string | null> {
  const { data: msg } = await supabaseAdmin
    .from("line_messages")
    .select("media_path, media_status")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg?.media_path || msg.media_status !== "stored") return null;
  const { data, error } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(msg.media_path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

// ── cron：メディア退避 ────────────────────────────────────────
export async function syncPendingMedia(limit = 50): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("line_messages")
    .select("id, friend_id, line_message_id")
    .eq("media_status", "pending")
    .limit(limit);
  if (!rows || rows.length === 0) return 0;

  for (const r of rows) {
    if (!r.line_message_id) {
      await supabaseAdmin.from("line_messages").update({ media_status: "failed" }).eq("id", r.id);
      continue;
    }
    try {
      const content = await getContent(r.line_message_id);
      const ext = (content.mime.split("/")[1] ?? "bin").split(";")[0];
      const path = `${r.friend_id}/${r.id}/${Date.now()}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from(MEDIA_BUCKET)
        .upload(path, content.bytes, { contentType: content.mime, upsert: false });
      if (error) throw error;
      await supabaseAdmin
        .from("line_messages")
        .update({ media_status: "stored", media_path: path, media_mime: content.mime })
        .eq("id", r.id);
    } catch (e) {
      console.error("syncPendingMedia error:", errMessage(e));
      await supabaseAdmin.from("line_messages").update({ media_status: "failed" }).eq("id", r.id);
    }
  }
  return rows.length;
}

// ── cron：プロフィール後追い ──────────────────────────────────
export async function syncFriendProfiles(limit = 50): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id")
    .is("display_name", null)
    .eq("status", "friend")
    .limit(limit);
  if (!rows || rows.length === 0) return 0;

  for (const f of rows) {
    try {
      const p = await getProfile(f.line_user_id);
      await supabaseAdmin
        .from("line_friends")
        .update({ display_name: p.displayName || "(名称未取得)", picture_url: p.pictureUrl || null })
        .eq("id", f.id);
    } catch (e) {
      // 取得失敗は次回リトライ（ブロック済み等）。ログのみ。
      console.error("syncFriendProfiles error:", errMessage(e));
    }
  }
  return rows.length;
}
