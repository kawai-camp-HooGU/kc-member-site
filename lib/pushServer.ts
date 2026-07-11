// ============================================================
// 通知（Web Push）サーバー側
//   - web-push + VAPID で送信
//   - 通知設定（マスター／種別）でフィルタ
//   - 失効した購読（404/410）は自動削除
//   ★ サーバー専用（VAPID_PRIVATE_KEY を使うため）
// ============================================================
import webpush from "web-push";
import { supabaseAdmin } from "./supabaseAdmin";

export type PushKind = "chat" | "news" | "test";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const PUBLIC_KEY  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT     = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

/** 種別ごとの通知が有効なメンバーIDだけに絞る */
async function filterBySettings(memberIds: number[], kind: PushKind): Promise<number[]> {
  if (memberIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("notification_settings").select("*").in("member_id", memberIds);
  const byId = new Map((data ?? []).map((r) => [r.member_id, r]));
  return memberIds.filter((id) => {
    const s = byId.get(id);
    if (!s) return true;                       // 未設定は既定ON
    if (!s.enabled) return false;              // マスターOFF
    if (kind === "chat") return s.chat_enabled !== false;
    if (kind === "news") return s.news_enabled !== false;
    return true;                               // test はマスターのみ見る
  });
}

/** 指定メンバーの全端末へプッシュ送信 */
export async function sendToMembers(memberIds: number[], payload: PushPayload, kind: PushKind): Promise<number> {
  if (!ensureConfigured()) {
    console.warn("VAPIDキーが未設定のためプッシュを送信できません");
    return 0;
  }
  const targets = await filterBySettings([...new Set(memberIds)].filter((id) => id != null), kind);
  if (targets.length === 0) return 0;

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions").select("*").in("member_id", targets);
  if (!subs || subs.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? kind,
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);  // 失効
      else console.error("push send error:", code, e);
    }
  }));

  if (dead.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", dead);
  }
  return sent;
}

// ── お知らせの公開対象メンバーを解決（属性＋公開条件）──
type Mode = "any" | "all" | "exany" | "exall";

export async function resolveNewsTargets(newsId: number): Promise<{ memberIds: number[]; title: string; body: string } | null> {
  const { data: news } = await supabaseAdmin.from("news").select("*").eq("id", newsId).maybeSingle();
  if (!news || !news.published || news.is_deleted) return null;

  const { data: newsAttrs } = await supabaseAdmin
    .from("news_attributes").select("attribute_id").eq("news_id", newsId);
  const targetTags = (newsAttrs ?? []).map((r) => r.attribute_id);

  const { data: members } = await supabaseAdmin
    .from("members").select("id, is_deleted").eq("is_deleted", false);
  const allIds = (members ?? []).map((m) => m.id);
  if (targetTags.length === 0) {
    return { memberIds: allIds, title: news.title || "新しいお知らせ", body: "新しいお知らせが公開されました" };
  }

  // 属性の祖先集合（自身を含む）を作る
  const { data: attrs } = await supabaseAdmin.from("attributes").select("id, parent_id").eq("is_deleted", false);
  const parentOf = new Map<number, number | null>((attrs ?? []).map((a) => [a.id, a.parent_id]));
  const ancestorsOf = (id: number): Set<number> => {
    const set = new Set<number>();
    let cur: number | null | undefined = id;
    while (cur != null) { set.add(cur); cur = parentOf.get(cur) ?? null; }
    return set;
  };

  const { data: memberAttrs } = await supabaseAdmin.from("member_attributes").select("member_id, attribute_id");
  const byMember = new Map<number, number[]>();
  (memberAttrs ?? []).forEach((r) => {
    const arr = byMember.get(r.member_id) ?? [];
    arr.push(r.attribute_id);
    byMember.set(r.member_id, arr);
  });

  const covers = (memberId: number, tag: number): boolean =>
    (byMember.get(memberId) ?? []).some((aid) => ancestorsOf(aid).has(tag));

  const mode = (news.attr_mode as Mode) ?? "any";
  const memberIds = allIds.filter((id) => {
    const some = targetTags.some((t) => covers(id, t));
    const every = targetTags.every((t) => covers(id, t));
    switch (mode) {
      case "any":   return some;
      case "all":   return every;
      case "exany": return !some;
      case "exall": return !every;
      default:      return true;
    }
  });

  return { memberIds, title: news.title || "新しいお知らせ", body: "新しいお知らせが公開されました" };
}

// ── チャットの受信者を解決 ──
export async function resolveChatTargets(conversationId: number, senderSide: string, senderMemberId: number | null)
  : Promise<number[]> {
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv) return [];

  if (senderSide === "staff") {
    // スタッフ発 → 会話相手（メンバー）へ
    return conv.member_id != null ? [conv.member_id] : [];
  }
  // メンバー発 → 担当スタッフへ（未割当なら管理者・オペレーター全員）
  if (conv.assigned_to != null) return [conv.assigned_to];
  const { data: staff } = await supabaseAdmin
    .from("members").select("id, role, is_deleted")
    .eq("is_deleted", false)
    .in("role", ["管理者", "オペレーター"]);
  return (staff ?? []).map((m) => m.id).filter((id) => id !== senderMemberId);
}
