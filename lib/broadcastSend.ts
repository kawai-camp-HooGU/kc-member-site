// ============================================================
// 一斉配信の送信エンジン（サーバー専用・service role 使用）
//   即時送信 / 予約(cron) の両方から呼ばれる。
//   - 宛先抽出（属性ABC・流入経路）
//   - 変数差し込み
//   - URL を計測リンクへ置換（クリックを訪問者として記録）
//   - チャット挿入 ＋ メール送信
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { renderMessage, extractUrls, matchRecipient } from "./broadcast";
import { sendMail, isEmailConfigured } from "./email";
import type { Member } from "./models";

interface SendResult { ok: boolean; recipientCount: number; error?: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toHtml(text: string): string {
  const linked = esc(text).replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${linked.replace(/\n/g, "<br>")}</div>`;
}

/** 顧客情報を取得（属性IDを含む） */
async function loadMembers(): Promise<Member[]> {
  const { data: rows } = await supabaseAdmin
    .from("members")
    .select("id, name, role, email, company, kana, prefecture, source, user_id, is_deleted");
  const { data: attrs } = await supabaseAdmin.from("member_attributes").select("member_id, attribute_id");
  const attrByMember = new Map<number, number[]>();
  for (const a of attrs ?? []) {
    const arr = attrByMember.get(a.member_id) ?? [];
    arr.push(a.attribute_id);
    attrByMember.set(a.member_id, arr);
  }
  return (rows ?? []).map((r) => ({
    id: r.id, name: r.name, role: r.role ?? "メンバー", userId: r.user_id ?? null,
    email: r.email ?? "", company: r.company ?? "", chatId: "", isDeleted: r.is_deleted ?? false,
    kana: r.kana ?? "", tel: "", prefecture: r.prefecture ?? "", source: r.source ?? "",
    attrIds: attrByMember.get(r.id) ?? [], memos: [],
  }));
}

async function ensureConversation(memberId: number): Promise<number | null> {
  const { data: conv } = await supabaseAdmin.from("chat_conversations").select("id").eq("member_id", memberId).maybeSingle();
  if (conv) return conv.id;
  const { data: created } = await supabaseAdmin.from("chat_conversations").insert({ member_id: memberId }).select("id").single();
  return created?.id ?? null;
}

/** 配信を実行して sent にする（冪等：既に sent ならスキップ） */
export async function runBroadcast(broadcastId: number): Promise<SendResult> {
  const { data: b } = await supabaseAdmin.from("broadcasts").select("*").eq("id", broadcastId).maybeSingle();
  if (!b) return { ok: false, recipientCount: 0, error: "配信が見つかりません" };
  if (b.status === "sent") return { ok: true, recipientCount: b.recipient_count ?? 0 };

  // 流入経路ラベル
  const { data: settings } = await supabaseAdmin.from("app_settings").select("welcome_routes").eq("id", 1).maybeSingle();
  const routes = Array.isArray(settings?.welcome_routes) ? (settings!.welcome_routes as { key?: string; label?: string }[]) : [];
  const routeLabel = (key: string) => routes.find((r) => r?.key === key)?.label ?? key;

  // 宛先
  const members = await loadMembers();
  const target = {
    targetMode: (b.target_mode === "all" ? "all" : "filter") as "all" | "filter",
    targetAttrIds: Array.isArray(b.target_attr_ids) ? (b.target_attr_ids as number[]) : [],
    targetSource: b.target_source ?? "",
  };
  const recipients = members.filter((m) => matchRecipient(m, target));

  // 計測URL（本文のURLごとに link を作成。再送時は作り直し）
  const urls = extractUrls(b.message_body ?? "");
  await supabaseAdmin.from("broadcast_links").delete().eq("broadcast_id", broadcastId);
  const urlToLinkId = new Map<string, number>();
  for (const url of urls) {
    const { data: link } = await supabaseAdmin.from("broadcast_links").insert({ broadcast_id: broadcastId, url }).select("id").single();
    if (link) urlToLinkId.set(url, link.id);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const trackify = (text: string, memberId: number): string => {
    let out = text;
    for (const [url, linkId] of urlToLinkId) {
      const track = `${siteUrl}/api/broadcast/click?l=${linkId}&m=${memberId}`;
      out = out.split(url).join(track);
    }
    return out;
  };

  const emailOn = b.channel_email && isEmailConfigured();
  let count = 0;
  for (const m of recipients) {
    const personalized = renderMessage(b.message_body ?? "", m, routeLabel);
    const body = trackify(personalized, m.id);

    if (b.channel_chat) {
      const cid = await ensureConversation(m.id);
      if (cid != null) {
        await supabaseAdmin.from("chat_messages").insert({ conversation_id: cid, sender_member_id: null, sender_side: "staff", body });
        const snip = body.length > 60 ? `${body.slice(0, 60)}…` : body;
        await supabaseAdmin.from("chat_conversations").update({ last_message_at: new Date().toISOString(), last_message_snip: snip }).eq("id", cid);
      }
    }
    if (emailOn && m.email) {
      try { await sendMail({ to: m.email, subject: b.title || "KAWAI CAMP からのお知らせ", text: body, html: toHtml(body) }); }
      catch { /* 個別のメール失敗は継続 */ }
    }
    count += 1;
  }

  await supabaseAdmin.from("broadcasts").update({
    status: "sent", sent_at: new Date().toISOString(), recipient_count: count, updated_at: new Date().toISOString(),
  }).eq("id", broadcastId);

  return { ok: true, recipientCount: count };
}
