// ============================================================
// 一斉配信 データアクセス＆共通ヘルパー
//   - CRUD（一覧/取得/保存/削除）
//   - 宛先判定（属性ABC・流入経路）
//   - 変数差し込み・URL抽出（送信/プレビュー共通）
//   - クリック（訪問者）集計
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { Broadcast, BroadcastStatus, Member } from "./models";

// ── 変換 ──────────────────────────────────────────────────────
export function toBroadcast(r: Tables<"broadcasts">): Broadcast {
  return {
    id: r.id,
    title: r.title ?? "",
    status: (r.status as BroadcastStatus) ?? "draft",
    targetMode: (r.target_mode === "all" ? "all" : "filter"),
    targetAttrIds: Array.isArray(r.target_attr_ids) ? (r.target_attr_ids as number[]) : [],
    targetSource: r.target_source ?? "",
    channelChat: r.channel_chat ?? true,
    channelEmail: r.channel_email ?? false,
    scheduledAt: r.scheduled_at ?? "",
    messageBody: r.message_body ?? "",
    recipientCount: r.recipient_count ?? 0,
    sentAt: r.sent_at ?? "",
    createdAt: r.created_at ?? "",
    aiAssisted: r.ai_assisted ?? false,
  };
}

// ── CRUD ──────────────────────────────────────────────────────
export async function fetchBroadcasts(): Promise<Broadcast[]> {
  const { data, error } = await supabase.from("broadcasts").select("*").order("id", { ascending: false });
  if (error || !data) return [];
  return data.map(toBroadcast);
}

export async function fetchBroadcast(id: number): Promise<Broadcast | null> {
  const { data } = await supabase.from("broadcasts").select("*").eq("id", id).maybeSingle();
  return data ? toBroadcast(data) : null;
}

/** 下書き/予約の保存（新規はidを返す） */
export async function saveBroadcast(b: Broadcast): Promise<number | null> {
  const row = {
    title: b.title,
    status: b.status,
    target_mode: b.targetMode,
    target_attr_ids: b.targetAttrIds as unknown as Tables<"broadcasts">["target_attr_ids"],
    target_source: b.targetSource || null,
    channel_chat: b.channelChat,
    channel_email: b.channelEmail,
    scheduled_at: b.scheduledAt || null,
    message_body: b.messageBody,
    ai_assisted: b.aiAssisted ?? false,
    updated_at: new Date().toISOString(),
  };
  if (b.id > 0) {
    const { error } = await supabase.from("broadcasts").update(row).eq("id", b.id);
    return error ? null : b.id;
  }
  const { data, error } = await supabase.from("broadcasts").insert(row).select("id").single();
  return error || !data ? null : data.id;
}

export async function deleteBroadcast(id: number): Promise<void> {
  await supabase.from("broadcasts").delete().eq("id", id);
}

// ── 宛先判定 ──────────────────────────────────────────────────
export function matchRecipient(m: Member, b: Pick<Broadcast, "targetMode" | "targetAttrIds" | "targetSource">): boolean {
  if (m.isDeleted) return false;
  // 配信対象は顧客（メンバー / 外部）のみ。運営スタッフは除外。
  if (m.role === "管理者" || m.role === "オペレーター") return false;
  if (b.targetMode === "all") return true;
  if (b.targetSource && m.source !== b.targetSource) return false;
  if (b.targetAttrIds.length > 0) {
    const ids = m.attrIds ?? [];
    if (!b.targetAttrIds.some((id) => ids.includes(id))) return false;
  }
  return true;
}

export function computeRecipients(members: Member[], b: Broadcast): Member[] {
  return members.filter((m) => matchRecipient(m, b));
}

// ── 変数差し込み・URL抽出（送信/プレビュー共通）───────────────
type RouteLabel = (key: string) => string;
const rep = (s: string, token: string, val: string) => s.split(token).join(val);

export function renderMessage(tpl: string, m: Partial<Member>, routeLabel: RouteLabel = (k) => k): string {
  let s = tpl;
  s = rep(s, "{{氏名}}", m.name ?? "");
  s = rep(s, "{{セイ}}", m.kana ?? "");
  s = rep(s, "{{所属}}", m.company ?? "");
  s = rep(s, "{{流入経路}}", m.source ? routeLabel(m.source) : "");
  s = rep(s, "{{都道府県}}", m.prefecture ?? "");
  s = rep(s, "{{メール}}", m.email ?? "");
  return s;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return Array.from(new Set(found));
}

// ── クリック（訪問者）集計 ────────────────────────────────────
export interface BroadcastVisitor {
  memberId: number | null;
  name: string;
  source: string;
  attrIds: number[];
  firstClick: string;
  lastClick: string;
  count: number;
}
export interface LinkStat { linkId: number; url: string; clicks: number; uniques: number; }

/** 配信の計測URL一覧＋各URLのクリック集計 */
export async function fetchBroadcastLinks(broadcastId: number): Promise<LinkStat[]> {
  const { data: links } = await supabase.from("broadcast_links").select("*").eq("broadcast_id", broadcastId);
  if (!links || links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const { data: clicks } = await supabase.from("broadcast_clicks").select("link_id, member_id").in("link_id", ids);
  return links.map((l) => {
    const cs = (clicks ?? []).filter((c) => c.link_id === l.id);
    const uniques = new Set(cs.map((c) => c.member_id ?? -1)).size;
    return { linkId: l.id, url: l.url, clicks: cs.length, uniques };
  });
}

/** 指定URL（link）の訪問者一覧 */
export async function fetchVisitors(linkId: number, members: Member[]): Promise<BroadcastVisitor[]> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const { data: clicks } = await supabase.from("broadcast_clicks").select("member_id, clicked_at").eq("link_id", linkId).order("clicked_at", { ascending: true });
  const map = new Map<number, BroadcastVisitor>();
  for (const c of clicks ?? []) {
    const key = c.member_id ?? -1;
    const at = c.clicked_at ?? "";
    const cur = map.get(key);
    if (cur) { cur.count += 1; cur.lastClick = at; }
    else {
      const m = c.member_id != null ? byId.get(c.member_id) : undefined;
      map.set(key, {
        memberId: c.member_id ?? null,
        name: m?.name ?? "（不明）",
        source: m?.source ?? "",
        attrIds: m?.attrIds ?? [],
        firstClick: at, lastClick: at, count: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
