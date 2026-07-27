// ============================================================
// LINE連携 データアクセス（クライアント安全）
//   ・型変換（toLineFriend / toLineMessage）
//   ・一覧／会話の取得、既読、署名URL取得（RLS=運営で直接 supabase）
//   ⚠️ 送信・受信保存はサーバー（/api/line/*・lib/lineServer.ts）で行う。
//      ここにはクライアントから呼んで安全な参照系のみを置く。
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
import type { Tables } from "./database.types";
import type {
  LineFriend, LineFriendStatus, LineMessage, LineDirection, LineMsgType, LineMediaStatus, LineSendKind,
} from "./models";

// ── 変換 ──────────────────────────────────────────────────────
const FRIEND_STATUSES: LineFriendStatus[] = ["friend", "blocked", "unfollowed"];
const toStatus = (v: string | null | undefined): LineFriendStatus =>
  (FRIEND_STATUSES as string[]).includes(v ?? "") ? (v as LineFriendStatus) : "friend";

const MSG_TYPES: LineMsgType[] =
  ["text", "image", "video", "audio", "file", "sticker", "location", "flex", "other"];
const toMsgType = (v: string | null | undefined): LineMsgType =>
  (MSG_TYPES as string[]).includes(v ?? "") ? (v as LineMsgType) : "text";

const MEDIA_STATUSES: LineMediaStatus[] = ["none", "pending", "stored", "failed"];
const toMediaStatus = (v: string | null | undefined): LineMediaStatus =>
  (MEDIA_STATUSES as string[]).includes(v ?? "") ? (v as LineMediaStatus) : "none";

const SEND_KINDS: LineSendKind[] = ["reply", "push", "multicast", "narrowcast"];
const toSendKind = (v: string | null | undefined): LineSendKind | null =>
  (SEND_KINDS as string[]).includes(v ?? "") ? (v as LineSendKind) : null;

export function toLineFriend(r: Tables<"line_friends">): LineFriend {
  return {
    id: r.id,
    accountId: r.account_id,
    lineUserId: r.line_user_id,
    memberId: r.member_id,
    displayName: r.display_name ?? "",
    pictureUrl: r.picture_url ?? "",
    status: toStatus(r.status),
    followedAt: r.followed_at ?? "",
    unfollowedAt: r.unfollowed_at ?? "",
    lastMessageAt: r.last_message_at ?? "",
    lastMessageSnip: r.last_message_snip ?? "",
    staffLastReadAt: r.staff_last_read_at ?? "",
    assignedTo: r.assigned_to,
    sourceId: r.source_id,
    tagIds: Array.isArray(r.tag_ids) ? r.tag_ids : [],
    createdAt: r.created_at ?? "",
  };
}

export function toLineMessage(r: Tables<"line_messages">): LineMessage {
  const direction = (r.direction === "out" ? "out" : "in") as LineDirection;
  return {
    id: r.id,
    accountId: r.account_id,
    friendId: r.friend_id,
    lineMessageId: r.line_message_id,
    direction,
    msgType: toMsgType(r.msg_type),
    body: r.body ?? "",
    mediaStatus: toMediaStatus(r.media_status),
    mediaPath: r.media_path,
    mediaMime: r.media_mime,
    sentBy: r.sent_by,
    sendKind: toSendKind(r.send_kind),
    createdAt: r.created_at ?? "",
  };
}

// ── 未読数 ────────────────────────────────────────────────────
/** 顧客発（direction='in'）で staff_last_read_at より後の件数を未読とみなす。 */
export function unreadOf(friend: Pick<LineFriend, "staffLastReadAt">, messages: LineMessage[]): number {
  const since = friend.staffLastReadAt ? new Date(friend.staffLastReadAt).getTime() : 0;
  return messages.filter(
    (m) => m.direction === "in" && new Date(m.createdAt).getTime() > since
  ).length;
}

// ── 取得（一覧）──────────────────────────────────────────────
/** 友だち一覧。新着（last_message_at）が上。既定は有効な友だちに絞らず全件返す。 */
export async function fetchLineFriends(): Promise<LineFriend[]> {
  const { data, error } = await supabase
    .from("line_friends")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (error || !data) return [];
  return data.map(toLineFriend);
}

/** 未読合計（サイドバーのバッジ用）。in メッセージのうち各友だちの既読位置より後の総数。 */
export async function fetchLineUnreadTotal(): Promise<number> {
  const friends = await fetchLineFriends();
  if (friends.length === 0) return 0;
  const { data } = await supabase
    .from("line_messages")
    .select("friend_id, direction, created_at")
    .eq("direction", "in");
  if (!data) return 0;
  const readMap = new Map(friends.map((f) => [f.id, f.staffLastReadAt ? new Date(f.staffLastReadAt).getTime() : 0]));
  let total = 0;
  for (const m of data) {
    const since = readMap.get(m.friend_id);
    if (since == null) continue;
    if (new Date(m.created_at ?? 0).getTime() > since) total += 1;
  }
  return total;
}

/** 友だちごとの未読数（direction='in' かつ既読位置より後）。一覧のバッジ用。 */
export async function fetchLineUnreadMap(friends: LineFriend[]): Promise<Record<number, number>> {
  const map: Record<number, number> = {};
  if (friends.length === 0) return map;
  const { data } = await supabase
    .from("line_messages")
    .select("friend_id, created_at")
    .eq("direction", "in");
  if (!data) return map;
  const readMap = new Map(friends.map((f) => [f.id, f.staffLastReadAt ? new Date(f.staffLastReadAt).getTime() : 0]));
  for (const m of data) {
    const since = readMap.get(m.friend_id);
    if (since == null) continue;
    if (new Date(m.created_at ?? 0).getTime() > since) map[m.friend_id] = (map[m.friend_id] ?? 0) + 1;
  }
  return map;
}

// ── 取得（会話）──────────────────────────────────────────────
export async function fetchLineMessages(friendId: number): Promise<LineMessage[]> {
  const { data, error } = await supabase
    .from("line_messages")
    .select("*")
    .eq("friend_id", friendId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) return [];
  return data.map(toLineMessage);
}

// ── 既読（「確認済にする」）───────────────────────────────────
export async function markLineFriendRead(friendId: number): Promise<void> {
  await supabase
    .from("line_friends")
    .update({ staff_last_read_at: new Date().toISOString() })
    .eq("id", friendId);
}

// ── 受信メディアの署名URL（サーバー経由で発行）────────────────
export async function fetchLineMediaUrl(messageId: number): Promise<string | null> {
  const res = await apiFetch(`/api/line/media?messageId=${messageId}`, { method: "GET" });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { url?: string };
  return j.url ?? null;
}

// ── 送信（Push。サーバーで LINE 送信＋保存）───────────────────
export async function sendLineMessage(friendId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/api/line/send", { method: "POST", body: { friendId, text } });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? "送信に失敗しました" };
  }
  return { ok: true };
}

// ── メディア送信（画像・動画）──────────────────────────────────
//   LINEは公開URL指定方式のため、まず公開バケットへ直接アップロードし、
//   そのパスをサーバーへ渡してLINE送信させる（Vercelの本文サイズ制限を回避）。
//   ⚠️ LINEはPDF等の任意ファイル送信に非対応。画像(JPEG/PNG)・動画(mp4)のみ。
const LINE_MEDIA_ACCEPT = ["image/jpeg", "image/png", "video/mp4"];
const OUTBOUND_BUCKET = "line-outbound";

export async function sendLineMedia(friendId: number, file: File): Promise<{ ok: boolean; error?: string }> {
  if (!LINE_MEDIA_ACCEPT.includes(file.type)) {
    return { ok: false, error: "画像(JPEG/PNG)または動画(mp4)を選択してください" };
  }
  const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
  const maxBytes = kind === "image" ? 10 * 1024 * 1024 : 200 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { ok: false, error: kind === "image" ? "画像は10MBまでです" : "動画は200MBまでです" };
  }

  const ext = (file.name.split(".").pop() ?? (kind === "image" ? "jpg" : "mp4"))
    .toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const uid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const path = `${friendId}/${uid}.${ext}`;

  const up = await supabase.storage.from(OUTBOUND_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, error: "アップロードに失敗しました" };

  const res = await apiFetch("/api/line/send-media", {
    method: "POST",
    body: { friendId, path, kind, mime: file.type },
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? "送信に失敗しました" };
  }
  return { ok: true };
}
