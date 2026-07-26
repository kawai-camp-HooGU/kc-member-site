// ============================================================
// LINE連携 サーバー処理（service_role / サーバー専用）
//   ・Webhookイベントの保存（friend upsert・message insert・自動あいさつ）
//   ・cron 向けヘルパー（メディア退避・プロフィール後追い）
//   ⚠️ 複数アカウント対応：すべて account 単位で扱う。
//   ⚠️ supabaseAdmin（RLS迂回）を使う。クライアントから import しないこと。
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
  id: string; type: string; text?: string; fileName?: string;
  packageId?: string; stickerId?: string; address?: string; title?: string;
}
export interface LineWebhookEvent {
  type: string; timestamp?: number; replyToken?: string;
  source?: LineSource; message?: LineMessageContent; deliveryContext?: LineDeliveryContext;
}
export interface LineWebhookBody { destination?: string; events?: LineWebhookEvent[] }

/** どのアカウント宛の受信かを示すコンテキスト（webhook から渡す）。 */
export interface LineEventContext { accountId: number; accessToken: string }

// ── ユーティリティ ────────────────────────────────────────────
const snip = (s: string): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};
const tsToIso = (ts?: number): string =>
  ts && Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();

function describeMessage(m: LineMessageContent): { type: string; body: string; hasMedia: boolean } {
  switch (m.type) {
    case "text":     return { type: "text",     body: m.text ?? "",                   hasMedia: false };
    case "image":    return { type: "image",    body: "画像を受信",                   hasMedia: true };
    case "video":    return { type: "video",    body: "動画を受信",                   hasMedia: true };
    case "audio":    return { type: "audio",    body: "音声を受信",                   hasMedia: true };
    case "file":     return { type: "file",     body: m.fileName ?? "ファイルを受信", hasMedia: true };
    case "sticker":  return { type: "sticker",  body: "スタンプを受信",               hasMedia: false };
    case "location": return { type: "location", body: m.title ?? m.address ?? "位置情報を受信", hasMedia: false };
    default:         return { type: "other",    body: `${m.type} を受信`,             hasMedia: false };
  }
}

// ── friend upsert（アカウント×userId で一意）──────────────────
async function upsertFriend(
  accountId: number,
  userId: string,
  patch: Partial<{ status: string; followed_at: string; unfollowed_at: string }> = {}
): Promise<{ id: number; source_id: number | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("line_friends")
    .upsert(
      { account_id: accountId, line_user_id: userId, ...patch },
      { onConflict: "account_id,line_user_id", ignoreDuplicates: false }
    )
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

// ── あいさつ選択（account×source → account×既定 → 全体既定）───
async function pickGreeting(accountId: number, sourceId: number | null): Promise<string | null> {
  if (sourceId != null) {
    const { data } = await supabaseAdmin
      .from("line_greetings")
      .select("message, is_enabled")
      .eq("account_id", accountId)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (data?.is_enabled && data.message) return data.message;
  }
  const { data: acctDef } = await supabaseAdmin
    .from("line_greetings")
    .select("message, is_enabled")
    .eq("account_id", accountId)
    .is("source_id", null)
    .maybeSingle();
  if (acctDef?.is_enabled && acctDef.message) return acctDef.message;

  // アカウント未設定なら全体既定（seed）にフォールバック
  const { data: globalDef } = await supabaseAdmin
    .from("line_greetings")
    .select("message, is_enabled")
    .is("account_id", null)
    .is("source_id", null)
    .maybeSingle();
  if (globalDef?.is_enabled && globalDef.message) return globalDef.message;
  return null;
}

// ── イベント処理 ──────────────────────────────────────────────
export async function handleLineEvent(ev: LineWebhookEvent, ctx: LineEventContext): Promise<void> {
  const userId = ev.source?.userId;
  if (!userId) return; // group/room 等 userId が無いソースは対象外

  if (ev.type === "message" && ev.message) {
    const friend = await upsertFriend(ctx.accountId, userId, { status: "friend" });
    if (!friend) return;
    const d = describeMessage(ev.message);
    const at = tsToIso(ev.timestamp);
    const { error } = await supabaseAdmin
      .from("line_messages")
      .upsert(
        {
          account_id: ctx.accountId,
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
    const isRedelivery = ev.deliveryContext?.isRedelivery === true;
    const friend = await upsertFriend(ctx.accountId, userId, { status: "friend", followed_at: tsToIso(ev.timestamp) });
    if (!friend) return;
    if (isRedelivery || !ev.replyToken) return;
    try {
      const greeting = await pickGreeting(ctx.accountId, friend.source_id);
      if (greeting) {
        await replyText(ctx.accessToken, ev.replyToken, greeting);
        await supabaseAdmin.from("line_messages").insert({
          account_id: ctx.accountId,
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
    await upsertFriend(ctx.accountId, userId, { status: "unfollowed", unfollowed_at: tsToIso(ev.timestamp) });
    return;
  }

  // postback 等：raw を残すだけ
  const friend = await upsertFriend(ctx.accountId, userId);
  if (friend) {
    await supabaseAdmin.from("line_messages").insert({
      account_id: ctx.accountId,
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
): Promise<{ id: number; account_id: number | null; line_user_id: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("id, account_id, line_user_id, status")
    .eq("id", friendId)
    .maybeSingle();
  return data ?? null;
}

export async function insertOutMessage(
  accountId: number | null,
  friendId: number,
  text: string,
  sentBy: number | null,
  sendKind: "push" | "reply"
): Promise<{ id: number } | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("line_messages")
    .insert({
      account_id: accountId,
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

// ── cron：メディア退避（アカウント単位）───────────────────────
export async function syncPendingMedia(accountId: number, accessToken: string, limit = 50): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("line_messages")
    .select("id, friend_id, line_message_id")
    .eq("account_id", accountId)
    .eq("media_status", "pending")
    .limit(limit);
  if (!rows || rows.length === 0) return 0;

  for (const r of rows) {
    if (!r.line_message_id) {
      await supabaseAdmin.from("line_messages").update({ media_status: "failed" }).eq("id", r.id);
      continue;
    }
    try {
      const content = await getContent(accessToken, r.line_message_id);
      const ext = (content.mime.split("/")[1] ?? "bin").split(";")[0];
      const path = `${accountId}/${r.friend_id}/${r.id}/${Date.now()}.${ext}`;
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

// ── cron：プロフィール後追い（アカウント単位）─────────────────
export async function syncFriendProfiles(accountId: number, accessToken: string, limit = 50): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id")
    .eq("account_id", accountId)
    .is("display_name", null)
    .eq("status", "friend")
    .limit(limit);
  if (!rows || rows.length === 0) return 0;

  for (const f of rows) {
    try {
      const p = await getProfile(accessToken, f.line_user_id);
      await supabaseAdmin
        .from("line_friends")
        .update({ display_name: p.displayName || "(名称未取得)", picture_url: p.pictureUrl || null })
        .eq("id", f.id);
    } catch (e) {
      console.error("syncFriendProfiles error:", errMessage(e));
    }
  }
  return rows.length;
}
