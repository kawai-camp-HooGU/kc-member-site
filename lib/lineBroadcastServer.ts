// ============================================================
// LINE配信（Phase 4・サーバー専用）
//   一斉配信＝Multicast（全員同一本文）、シナリオ＝Push（会員ごと・本文は差込済み）。
//   送信した各メッセージは line_messages に out として保存し、トーク履歴に残す。
//   ⚠️ 履歴には残すが last_message_at / snip は更新しない（並び順・未読を動かさない）。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { pushMulticast, pushText } from "./lineClient";
import { getAccessToken } from "./lineAccountsServer";
import { errMessage } from "./errors";

const MULTICAST_BATCH = 500;

/** 本文から差し込み変数（{{...}} / {...}）を除去（LINE一斉配信は全員同一本文のため）。 */
export function stripLineVariables(body: string): string {
  return (body ?? "").replace(/\{\{[^}]*\}\}/g, "").replace(/\{[^}]*\}/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

interface AudienceFriend { id: number; lineUserId: string }

/**
 * 一斉配信の宛先を解決する。
 *   mode='linked' … 属性等で絞った会員（memberIds）のうち、そのアカウントの連携済み友だち
 *   mode='all'    … そのアカウントの友だち全員（未連携含む）
 */
export async function getBroadcastAudience(
  accountId: number, mode: "linked" | "all", memberIds: number[]
): Promise<AudienceFriend[]> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id, member_id")
    .eq("account_id", accountId)
    .eq("status", "friend");
  let rows = data ?? [];
  if (mode === "linked") {
    const set = new Set(memberIds);
    rows = rows.filter((f) => f.member_id != null && set.has(f.member_id));
  }
  return rows.map((f) => ({ id: f.id, lineUserId: f.line_user_id }));
}

/** 送信履歴を line_messages に一括保存（out・並び順は動かさない）。 */
async function storeOutHistory(
  accountId: number, friendIds: number[], body: string, sendKind: "multicast" | "push"
): Promise<void> {
  if (friendIds.length === 0) return;
  const now = new Date().toISOString();
  const rows = friendIds.map((fid) => ({
    account_id: accountId, friend_id: fid, direction: "out", msg_type: "text",
    body, send_kind: sendKind, sent_by: null, created_at: now,
  }));
  for (let i = 0; i < rows.length; i += MULTICAST_BATCH) {
    const { error } = await supabaseAdmin.from("line_messages").insert(rows.slice(i, i + MULTICAST_BATCH));
    if (error) console.error("storeOutHistory error:", error.message);
  }
}

/** 一斉配信：Multicastで送信し、履歴を保存。届いた友だち数を返す。 */
export async function sendLineMulticast(
  accountId: number, accessToken: string, friends: AudienceFriend[], body: string
): Promise<number> {
  if (friends.length === 0 || !body.trim()) return 0;
  let sentIds: number[] = [];
  for (let i = 0; i < friends.length; i += MULTICAST_BATCH) {
    const batch = friends.slice(i, i + MULTICAST_BATCH);
    try {
      await pushMulticast(accessToken, batch.map((f) => f.lineUserId), body);
      sentIds = sentIds.concat(batch.map((f) => f.id));
    } catch (e) {
      console.error("sendLineMulticast batch error:", errMessage(e));
    }
  }
  await storeOutHistory(accountId, sentIds, body, "multicast");
  return sentIds.length;
}

/** シナリオ：1会員へPush送信（本文は差込済み）＋履歴保存。送信できたら true。 */
export async function sendLineToMember(
  accountId: number, accessToken: string, memberId: number, body: string
): Promise<boolean> {
  if (!body.trim()) return false;
  const { data: friend } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id, status")
    .eq("account_id", accountId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (!friend || friend.status !== "friend") return false;
  try {
    await pushText(accessToken, friend.line_user_id, body);
    await storeOutHistory(accountId, [friend.id], body, "push");
    return true;
  } catch (e) {
    console.error("sendLineToMember error:", errMessage(e));
    return false;
  }
}

/** アカウントのアクセストークンを取得（未設定なら null）。 */
export async function lineDeliveryToken(accountId: number): Promise<string | null> {
  return getAccessToken(accountId);
}
