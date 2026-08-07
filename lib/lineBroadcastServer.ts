// ============================================================
// LINE配信（Phase 4・サーバー専用）
//   一斉配信＝Multicast（全員同一本文）、シナリオ＝Push（会員ごと・本文は差込済み）。
//   送信した各メッセージは line_messages に out として保存し、トーク履歴に残す。
//   ⚠️ 履歴には残すが last_message_at / snip は更新しない（並び順・未読を動かさない）。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { pushMulticast, pushText, multicastMessages, pushMessages } from "./lineClient";
import { getAccessToken } from "./lineAccountsServer";
import { loadAttrTree, canView } from "./ai/context";
import type { PublishMode } from "./models";
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

/**
 * 属性で宛先を絞る（未連携の友だちも含む・Phase 6）。
 *   ・連携済みの友だち … 会員の属性で判定
 *   ・未連携の友だち   … 友だち自身の属性（member_attributes.friend_id）で判定
 *   member_attributes は会員/友だち両対応。属性の親子は canView（祖先集合）で解決する。
 *   targetAttrIds が空なら全友だち（＝実質「友だち全員」）。
 */
export async function getBroadcastAudienceByAttr(
  accountId: number, targetAttrIds: number[], attrMode: PublishMode
): Promise<AudienceFriend[]> {
  const { data } = await supabaseAdmin
    .from("line_friends").select("id, line_user_id, member_id")
    .eq("account_id", accountId).eq("status", "friend");
  const rows = data ?? [];
  if (rows.length === 0) return [];
  if (targetAttrIds.length === 0) return rows.map((f) => ({ id: f.id, lineUserId: f.line_user_id }));

  const tree = await loadAttrTree();
  const { data: attrs } = await supabaseAdmin
    .from("member_attributes").select("member_id, friend_id, attribute_id");
  const byMember = new Map<number, number[]>();
  const byFriend = new Map<number, number[]>();
  for (const a of attrs ?? []) {
    if (a.member_id != null) { const x = byMember.get(a.member_id) ?? []; x.push(a.attribute_id); byMember.set(a.member_id, x); }
    else if (a.friend_id != null) { const x = byFriend.get(a.friend_id) ?? []; x.push(a.attribute_id); byFriend.set(a.friend_id, x); }
  }

  const out: AudienceFriend[] = [];
  for (const f of rows) {
    const owned = f.member_id != null ? (byMember.get(f.member_id) ?? []) : (byFriend.get(f.id) ?? []);
    if (canView(targetAttrIds, attrMode, owned, tree)) out.push({ id: f.id, lineUserId: f.line_user_id });
  }
  return out;
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

/** アカウントの LIFF ID（リッチメッセージのボタン→LIFF解決用）。未設定は ""。 */
export async function getAccountLiffId(accountId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from("line_accounts").select("liff_id").eq("id", accountId).maybeSingle();
  return data?.liff_id ?? "";
}

/** リッチメッセージを一斉送信（Multicast）＋履歴保存。届いた友だち数を返す。 */
export async function sendLineMulticastMessages(
  accountId: number, accessToken: string, friends: AudienceFriend[], messages: unknown[], historyText: string
): Promise<number> {
  if (friends.length === 0 || messages.length === 0) return 0;
  let sentIds: number[] = [];
  for (let i = 0; i < friends.length; i += MULTICAST_BATCH) {
    const batch = friends.slice(i, i + MULTICAST_BATCH);
    try {
      await multicastMessages(accessToken, batch.map((f) => f.lineUserId), messages);
      sentIds = sentIds.concat(batch.map((f) => f.id));
    } catch (e) {
      console.error("sendLineMulticastMessages batch error:", errMessage(e));
    }
  }
  await storeOutHistory(accountId, sentIds, historyText, "multicast");
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

/** シナリオ：1会員へリッチメッセージをPush（本文はステップ由来）＋履歴保存。送信できたら true。 */
export async function sendLineRichToMember(
  accountId: number, accessToken: string, memberId: number, messages: unknown[], historyText: string
): Promise<boolean> {
  if (messages.length === 0) return false;
  const { data: friend } = await supabaseAdmin
    .from("line_friends").select("id, line_user_id, status")
    .eq("account_id", accountId).eq("member_id", memberId).maybeSingle();
  if (!friend || friend.status !== "friend") return false;
  try {
    await pushMessages(accessToken, friend.line_user_id, messages);
    await storeOutHistory(accountId, [friend.id], historyText, "push");
    return true;
  } catch (e) {
    console.error("sendLineRichToMember error:", errMessage(e));
    return false;
  }
}

/** アカウントのアクセストークンを取得（未設定なら null）。 */
export async function lineDeliveryToken(accountId: number): Promise<string | null> {
  return getAccessToken(accountId);
}

/**
 * 会員に紐づく連携済み友だちへ Push（アクション「メッセージ送信」用）。
 *   会員のどのLINEアカウントに連携していても送れるよう、友だち行から account を解決する。
 */
export async function sendLineToMemberAny(memberId: number, body: string): Promise<boolean> {
  if (!body.trim()) return false;
  const { data: f } = await supabaseAdmin
    .from("line_friends").select("account_id, status")
    .eq("member_id", memberId).eq("status", "friend").maybeSingle();
  if (!f || f.account_id == null) return false;
  const token = await getAccessToken(f.account_id);
  if (!token) return false;
  return sendLineToMember(f.account_id, token, memberId, body);
}

/**
 * 未連携の友だちへ直接 Push（LINE入口の初回フォロー等・アクション「メッセージ送信」用）。
 *   friendId から account と userId を解決して送る。履歴も残す。
 */
export async function sendLineToFriend(friendId: number, body: string): Promise<boolean> {
  if (!body.trim()) return false;
  const { data: f } = await supabaseAdmin
    .from("line_friends").select("id, line_user_id, account_id, status")
    .eq("id", friendId).maybeSingle();
  if (!f || f.status !== "friend" || f.account_id == null || !f.line_user_id) return false;
  const token = await getAccessToken(f.account_id);
  if (!token) return false;
  try {
    await pushText(token, f.line_user_id, body);
    await storeOutHistory(f.account_id, [f.id], body, "push");
    return true;
  } catch (e) {
    console.error("sendLineToFriend error:", errMessage(e));
    return false;
  }
}
