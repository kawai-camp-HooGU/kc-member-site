// ============================================================
// LINE分析 データ集計（クライアント安全・Phase 7④）
//   蓄積済みデータ（line_friends / sources / broadcasts / broadcast_links / broadcast_clicks）
//   を運営RLSで読み、KPI・友だち増減・流入経路別・配信効果を集計する。
// ============================================================
import { supabase } from "./supabase";

export interface LineStats {
  total: number;          // 現在の友だち数（status=friend）
  linked: number;         // うち会員連携済み
  blockedEver: number;    // ブロック/解除（status!=friend）
  linkedRate: number;     // 連携率(%)
  blockRate: number;      // ブロック率(%)＝解除/総登録
  growth: { label: string; follows: number; unfollows: number; net: number }[];
  sources: { label: string; friends: number; linked: number }[];
  /** 経路別ブロック分析（登録総数に対する現在のブロック/解除率） */
  sourceBlocks: { label: string; total: number; blocked: number; blockRate: number }[];
  broadcasts: { id: number; title: string; sent: number; clicks: number; rate: number; sentAt: string }[];
}

/**
 * 配信のLINE宛先人数プレビュー（クライアント・目安）。
 *   all=友だち全員 / linked=絞り込み会員∩友だち（正確）/ attr=属性一致の友だち（未連携含む・目安）。
 *   ⚠️ attr は属性の親子展開を行わない簡易判定のため「目安」。実送信はサーバーが正確に判定。
 */
export async function fetchLineAudienceCount(
  accountId: number,
  mode: "linked" | "attr" | "all",
  linkedMemberIds: number[],
  targetAttrIds: number[],
  attrMode: string,
  excludeIds: number[],
): Promise<number> {
  const { data: fr } = await supabase
    .from("line_friends").select("id, member_id, status").eq("account_id", accountId).eq("status", "friend");
  const friends = fr ?? [];
  if (mode === "all") return friends.length;
  if (mode === "linked") {
    const set = new Set(linkedMemberIds);
    return friends.filter((f) => f.member_id != null && set.has(f.member_id)).length;
  }
  // attr（目安）
  if (targetAttrIds.length === 0 && excludeIds.length === 0) return friends.length;
  const { data: attrs } = await supabase.from("member_attributes").select("member_id, friend_id, attribute_id");
  const byMember = new Map<number, number[]>(), byFriend = new Map<number, number[]>();
  for (const a of attrs ?? []) {
    if (a.member_id != null) { const x = byMember.get(a.member_id) ?? []; x.push(a.attribute_id); byMember.set(a.member_id, x); }
    else if (a.friend_id != null) { const x = byFriend.get(a.friend_id) ?? []; x.push(a.attribute_id); byFriend.set(a.friend_id, x); }
  }
  let n = 0;
  for (const f of friends) {
    const owned = f.member_id != null ? (byMember.get(f.member_id) ?? []) : (byFriend.get(f.id) ?? []);
    if (excludeIds.length && excludeIds.some((id) => owned.includes(id))) continue;
    if (targetAttrIds.length === 0) { n += 1; continue; }
    const any = targetAttrIds.some((id) => owned.includes(id));
    const all = targetAttrIds.every((id) => owned.includes(id));
    const ok = attrMode === "all" ? all : attrMode === "exany" ? !any : attrMode === "exall" ? !all : any;
    if (ok) n += 1;
  }
  return n;
}

function weekStart(offsetWeeks: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 月曜=0
  d.setDate(d.getDate() - day - offsetWeeks * 7);
  return d;
}
const mmdd = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

export async function fetchLineStats(accountId: number | null): Promise<LineStats | null> {
  if (accountId == null) return null;

  const [{ data: fr }, { data: src }] = await Promise.all([
    supabase.from("line_friends")
      .select("id, member_id, status, source_id, followed_at, unfollowed_at")
      .eq("account_id", accountId),
    supabase.from("sources").select("id, label"),
  ]);
  const friends = fr ?? [];
  const sourceLabel = new Map<number, string>((src ?? []).map((s) => [s.id, s.label ?? ""]));

  const active = friends.filter((f) => f.status === "friend");
  const total = active.length;
  const linked = active.filter((f) => f.member_id != null).length;
  const blockedEver = friends.filter((f) => f.status !== "friend").length;
  const linkedRate = total ? Math.round((linked / total) * 1000) / 10 : 0;
  const blockRate = friends.length ? Math.round((blockedEver / friends.length) * 1000) / 10 : 0;

  // 友だち増減（直近12週）
  const growth: LineStats["growth"] = [];
  for (let w = 11; w >= 0; w--) {
    const start = weekStart(w).getTime();
    const end = weekStart(w - 1).getTime();
    const follows = friends.filter((f) => f.followed_at && new Date(f.followed_at).getTime() >= start && new Date(f.followed_at).getTime() < end).length;
    const unfollows = friends.filter((f) => f.unfollowed_at && new Date(f.unfollowed_at).getTime() >= start && new Date(f.unfollowed_at).getTime() < end).length;
    growth.push({ label: mmdd(weekStart(w)), follows, unfollows, net: follows - unfollows });
  }

  // 流入経路別
  const bySource = new Map<number | -1, { friends: number; linked: number }>();
  for (const f of active) {
    const key = f.source_id ?? -1;
    const cur = bySource.get(key) ?? { friends: 0, linked: 0 };
    cur.friends += 1;
    if (f.member_id != null) cur.linked += 1;
    bySource.set(key, cur);
  }
  const sources = [...bySource.entries()]
    .map(([id, v]) => ({ label: id === -1 ? "経路なし" : (sourceLabel.get(id) || `#${id}`), friends: v.friends, linked: v.linked }))
    .sort((a, b) => b.friends - a.friends);

  // 経路別ブロック分析（登録総数＝active＋blocked を分母に、現在ブロック/解除の割合）
  const byBlock = new Map<number | -1, { total: number; blocked: number }>();
  for (const f of friends) {
    const key = f.source_id ?? -1;
    const cur = byBlock.get(key) ?? { total: 0, blocked: 0 };
    cur.total += 1;
    if (f.status !== "friend") cur.blocked += 1;
    byBlock.set(key, cur);
  }
  const sourceBlocks = [...byBlock.entries()]
    .map(([id, v]) => ({
      label: id === -1 ? "経路なし" : (sourceLabel.get(id) || `#${id}`),
      total: v.total, blocked: v.blocked,
      blockRate: v.total ? Math.round((v.blocked / v.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.blockRate - a.blockRate);

  // 配信効果（LINE配信・直近20件）
  const { data: bc } = await supabase.from("broadcasts")
    .select("id, title, line_sent_count, sent_at, channel_line, line_account_id, status")
    .eq("channel_line", true).eq("line_account_id", accountId).eq("status", "sent")
    .order("sent_at", { ascending: false }).limit(20);
  const bcs = bc ?? [];
  const bcIds = bcs.map((b) => b.id);
  let clickByB = new Map<number, number>();
  if (bcIds.length) {
    const { data: links } = await supabase.from("broadcast_links").select("id, broadcast_id").in("broadcast_id", bcIds);
    const linkToB = new Map<number, number>((links ?? []).map((l) => [l.id, l.broadcast_id]));
    const linkIds = (links ?? []).map((l) => l.id);
    if (linkIds.length) {
      const { data: clicks } = await supabase.from("broadcast_clicks").select("link_id").in("link_id", linkIds);
      for (const c of clicks ?? []) {
        const b = linkToB.get(c.link_id);
        if (b != null) clickByB.set(b, (clickByB.get(b) ?? 0) + 1);
      }
    }
  }
  const broadcasts = bcs.map((b) => {
    const sent = b.line_sent_count ?? 0;
    const clicks = clickByB.get(b.id) ?? 0;
    return { id: b.id, title: b.title ?? "（無題）", sent, clicks, rate: sent ? Math.round((clicks / sent) * 1000) / 10 : 0, sentAt: (b.sent_at ?? "").slice(0, 10) };
  });

  return { total, linked, blockedEver, linkedRate, blockRate, growth, sources, sourceBlocks, broadcasts };
}
