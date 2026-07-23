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
import { loadStaffRoleKeys } from "./rolesServer";
import type { BroadcastTarget } from "./broadcast";
import { loadSourceIndex } from "./sourcesServer";
import { sendMail, isEmailConfigured } from "./email";
import { ensureConversation, postChatMessage } from "./chatServer";
import type { Member, SourceCategory } from "./models";

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
    .select("id, name, role, email, company, kana, prefecture, source_id, user_id, is_deleted");
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
    kana: r.kana ?? "", tel: "", prefecture: r.prefecture ?? "", sourceId: r.source_id ?? null,
    attrIds: attrByMember.get(r.id) ?? [], memos: [],
  }));
}

/** 配信を実行して sent にする（冪等：既に sent ならスキップ） */
export async function runBroadcast(broadcastId: number): Promise<SendResult> {
  const { data: b } = await supabaseAdmin.from("broadcasts").select("*").eq("id", broadcastId).maybeSingle();
  if (!b) return { ok: false, recipientCount: 0, error: "配信が見つかりません" };
  if (b.status === "sent") return { ok: true, recipientCount: b.recipient_count ?? 0 };

  // 流入経路マスタ（Phase 3：welcome_routes(JSON) から sources テーブルへ）
  const sourceIndex = await loadSourceIndex();
  const sourceLabel = (id: number | null | undefined) => (id == null ? "" : sourceIndex.get(id)?.label ?? "");

  // 宛先
  const members = await loadMembers();
  const isEmailMode = b.target_mode === "email";
  const target: BroadcastTarget = {
    targetMode: (b.target_mode === "all" ? "all" : isEmailMode ? "email" : "filter"),
    targetAttrIds: Array.isArray(b.target_attr_ids) ? (b.target_attr_ids as number[]) : [],
    attrMode: (["any", "all", "exany", "exall"].includes(b.attr_mode) ? b.attr_mode : "any") as BroadcastTarget["attrMode"],
    targetSourceIds:  Array.isArray(b.target_source_ids)  ? b.target_source_ids : [],
    targetSourceCats: Array.isArray(b.target_source_cats) ? (b.target_source_cats as SourceCategory[]) : [],
  };
  // 運営ロール（派生ロール含む）は配信対象外。サーバー側なので明示的に解決する。
  const staffKeys = await loadStaffRoleKeys();
  const recipients = members.filter((m) => matchRecipient(m, target, sourceIndex, staffKeys));

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

  if (isEmailMode) {
    // ③ メールアドレス指定配信：貼り付けられたメアドへ個別送信（チャネルはメール固定）。
    //   会員に一致すれば変数差し込み用に情報を利用。未登録アドレスもそのまま送る。
    //   ⚠️ 顧客目線では TO に本人アドレスだけ（1通ずつ個別送信・CC/BCCなし）。
    const emails = Array.isArray(b.target_emails) ? (b.target_emails as string[]) : [];
    const byEmail = new Map(members.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m]));
    if (isEmailConfigured()) {
      for (const raw of emails) {
        const addr = raw.trim();
        if (!addr) continue;
        const mem = byEmail.get(addr.toLowerCase());
        const personalized = renderMessage(b.message_body ?? "", mem ?? { email: addr }, sourceLabel);
        const mailBody = trackify(personalized, mem?.id ?? 0);
        try { await sendMail({ to: addr, subject: b.title || "KAWAI CAMP からのお知らせ", text: mailBody, html: toHtml(mailBody) }); count += 1; }
        catch { /* 個別のメール失敗は継続 */ }
      }
    }
  } else {
    for (const m of recipients) {
      const personalized = renderMessage(b.message_body ?? "", m, sourceLabel);

      // ⚠️ チャットとメールで本文を分ける。
      //    メール … broadcast_links の計測URLに置換（trackify）
      //    チャット … 素のURLのまま投稿し、chat_links 側で計測する
      //               （二重にリダイレクタを噛ませると訪問記録が片方にしか残らない）
      if (b.channel_chat) {
        const cid = await ensureConversation(m.id);
        if (cid != null) await postChatMessage(cid, personalized, "broadcast");
      }
      if (emailOn && m.email) {
        const mailBody = trackify(personalized, m.id);
        try { await sendMail({ to: m.email, subject: b.title || "KAWAI CAMP からのお知らせ", text: mailBody, html: toHtml(mailBody) }); }
        catch { /* 個別のメール失敗は継続 */ }
      }
      count += 1;
    }
  }

  await supabaseAdmin.from("broadcasts").update({
    status: "sent", sent_at: new Date().toISOString(), recipient_count: count, updated_at: new Date().toISOString(),
  }).eq("id", broadcastId);

  return { ok: true, recipientCount: count };
}
