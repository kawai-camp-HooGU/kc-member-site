// ============================================================
// 対応サマリー：ポータルトーク・メール・LINE を横断した実データ集約
//   既存の各チャネル取得関数を束ねて1つの Summary にまとめる。
//   ⚠️ 運営専用（members / mail_* / line_* は RLS=is_ops / authenticated）。
// ============================================================
import { supabase } from "./supabase";
import { fetchUnreadTotal } from "./chat";
import { fetchAccounts as fetchMailAccounts } from "./mail";
import { fetchLineAccounts } from "./lineAccounts";
import { fetchLineFriends, fetchLineUnreadMap } from "./line";

export interface SummaryMail { id: number; address: string; desc: string; unhandled: number }
export interface SummaryLine { id: number; name: string; desc: string; friends: number; unhandled: number }
export interface Summary {
  portal: { registrants: number; unhandled: number };
  mails: SummaryMail[];
  lines: SummaryLine[];
}

/** アクティブ会員（ポータル登録者）：削除されておらず、認証アカウントを持つ会員 */
async function countActiveMembers(): Promise<number> {
  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("user_id", "is", null);
  return count ?? 0;
}

export async function fetchSummary(): Promise<Summary> {
  const [registrants, portalUnhandled, mailAccts, lineAccts, friends] = await Promise.all([
    countActiveMembers(),
    fetchUnreadTotal(true, null),   // 運営視点：ポータルトークの未読（＝未対応）総数
    fetchMailAccounts(),
    fetchLineAccounts(),
    fetchLineFriends(),
  ]);

  // LINE：友だち数・未対応数をアカウント別に集計
  const unreadMap = await fetchLineUnreadMap(friends);
  const friendsByAcct = new Map<number, number>();
  const unreadByAcct  = new Map<number, number>();
  for (const f of friends) {
    if (f.accountId == null) continue;
    if (f.status === "friend") friendsByAcct.set(f.accountId, (friendsByAcct.get(f.accountId) ?? 0) + 1);
    const u = unreadMap[f.id] ?? 0;
    if (u > 0) unreadByAcct.set(f.accountId, (unreadByAcct.get(f.accountId) ?? 0) + u);
  }

  return {
    portal: { registrants, unhandled: portalUnhandled },
    mails: mailAccts.map((a) => ({
      id: a.id,
      address: a.address,
      desc: a.displayName || "",
      unhandled: a.unread,
    })),
    lines: lineAccts.map((a) => ({
      id: a.id,
      name: a.name,
      desc: a.basicId ? `@${a.basicId.replace(/^@/, "")}` : "",
      friends: friendsByAcct.get(a.id) ?? 0,
      unhandled: unreadByAcct.get(a.id) ?? 0,
    })),
  };
}
