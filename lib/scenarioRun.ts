// ============================================================
// シナリオ配信 実行エンジン（サーバー専用・service role）
//   enroll()     … トリガー合致者を自動エントリー
//   deliverDue() … 各エントリーの「次ステップ」が配信時刻を過ぎたら送信
//   cron から runScenarioCron() を定期実行する
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { renderMessage } from "./broadcast";
import { matchSource } from "./sources";
import type { SourceIndex } from "./sources";
import { loadSourceIndex } from "./sourcesServer";
import { sendMail, isEmailConfigured } from "./email";
import type { Member, SourceCategory } from "./models";

type MemberX = Member & { welcomedAt: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(t).replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</div>`;

async function loadMembers(): Promise<MemberX[]> {
  const { data: rows } = await supabaseAdmin
    .from("members")
    .select("id, name, role, email, company, kana, prefecture, source_id, user_id, is_deleted, welcomed_at");
  const { data: attrs } = await supabaseAdmin.from("member_attributes").select("member_id, attribute_id");
  const byMember = new Map<number, number[]>();
  for (const a of attrs ?? []) { const arr = byMember.get(a.member_id) ?? []; arr.push(a.attribute_id); byMember.set(a.member_id, arr); }
  return (rows ?? []).map((r) => ({
    id: r.id, name: r.name, role: r.role ?? "メンバー", userId: r.user_id ?? null,
    email: r.email ?? "", company: r.company ?? "", chatId: "", isDeleted: r.is_deleted ?? false,
    kana: r.kana ?? "", tel: "", prefecture: r.prefecture ?? "", sourceId: r.source_id ?? null,
    attrIds: byMember.get(r.id) ?? [], memos: [], welcomedAt: r.welcomed_at ?? null,
  }));
}

const isCustomer = (m: MemberX) => !m.isDeleted && m.role !== "管理者" && m.role !== "オペレーター";

/** Phase 3：流入経路は複数 id の OR ＋ カテゴリ一括で判定する */
function matchTarget(
  m: MemberX,
  sourceIds: number[], sourceCats: SourceCategory[], targetAttrIds: number[],
  index: SourceIndex,
): boolean {
  if (!matchSource(m.sourceId, { targetSourceIds: sourceIds, targetSourceCats: sourceCats }, index)) return false;
  if (targetAttrIds.length > 0 && !targetAttrIds.some((id) => (m.attrIds ?? []).includes(id))) return false;
  return true;
}

// ── エンロール（自動トリガー）─────────────────────────────────
async function enroll(): Promise<number> {
  const { data: scenarios } = await supabaseAdmin.from("scenarios").select("*").eq("active", true);
  if (!scenarios || scenarios.length === 0) return 0;
  const members = await loadMembers();
  const sourceIndex = await loadSourceIndex();
  let enrolled = 0;

  for (const sc of scenarios) {
    if (sc.trigger_type === "manual") continue; // 手動は自動登録しない
    const attrIds  = Array.isArray(sc.target_attr_ids) ? (sc.target_attr_ids as number[]) : [];
    const srcIds   = Array.isArray(sc.target_source_ids)  ? sc.target_source_ids : [];
    const srcCats  = Array.isArray(sc.target_source_cats) ? (sc.target_source_cats as SourceCategory[]) : [];

    const { data: existing } = await supabaseAdmin.from("scenario_entries").select("member_id").eq("scenario_id", sc.id);
    const already = new Set((existing ?? []).map((e) => e.member_id));

    const candidates = members.filter((m) => {
      if (!isCustomer(m)) return false;
      if (already.has(m.id)) return false;
      if (!matchTarget(m, srcIds, srcCats, attrIds, sourceIndex)) return false;
      if (sc.trigger_type === "login") return m.welcomedAt != null;             // 初回ログイン済み
      if (sc.trigger_type === "source") return m.sourceId != null;              // 流入経路あり
      if (sc.trigger_type === "attribute") return (m.attrIds ?? []).length > 0; // 属性あり
      return false;
    });

    if (candidates.length > 0) {
      const rows = candidates.map((m) => ({ scenario_id: sc.id, member_id: m.id, next_step: 0, status: "active" }));
      await supabaseAdmin.from("scenario_entries").insert(rows);
      enrolled += rows.length;
    }
  }
  return enrolled;
}

// ── 配信時刻の算出（JST基準）──────────────────────────────────
function dueTime(enteredAt: string, unit: string, value: number, timeOfDay: string | null): Date {
  const base = new Date(enteredAt);
  if (unit === "immediate") return base;
  if (unit === "hours") return new Date(base.getTime() + value * 3600_000);
  // days
  const d = new Date(base.getTime() + value * 86_400_000);
  if (timeOfDay) {
    const [hh, mm] = timeOfDay.split(":").map((n) => Number(n));
    // JST(UTC+9)の hh:mm を UTC に変換して設定
    d.setUTCHours((hh - 9 + 24) % 24, mm || 0, 0, 0);
  }
  return d;
}

async function ensureStepLinks(scenarioId: number, stepId: number, urls: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (urls.length === 0) return map;
  const { data: existing } = await supabaseAdmin.from("scenario_links").select("id, url").eq("step_id", stepId);
  for (const e of existing ?? []) map.set(e.url, e.id);
  for (const url of urls) {
    if (map.has(url)) continue;
    const { data } = await supabaseAdmin.from("scenario_links").insert({ scenario_id: scenarioId, step_id: stepId, url }).select("id").single();
    if (data) map.set(url, data.id);
  }
  return map;
}

async function ensureConversation(memberId: number): Promise<number | null> {
  const { data: conv } = await supabaseAdmin.from("chat_conversations").select("id").eq("member_id", memberId).maybeSingle();
  if (conv) return conv.id;
  const { data: created } = await supabaseAdmin.from("chat_conversations").insert({ member_id: memberId }).select("id").single();
  return created?.id ?? null;
}

// ── 1ステップを1メンバーへ送信 ────────────────────────────────
async function sendStep(
  scenarioId: number,
  step: { id: number; channel_chat: boolean; channel_email: boolean; message_body: string },
  m: MemberX, sourceLabel: (id: number | null | undefined) => string, siteUrl: string,
): Promise<void> {
  const personalized = renderMessage(step.message_body ?? "", m, sourceLabel);
  const urls = Array.from(new Set((personalized.match(/https?:\/\/[^\s<>"']+/g) ?? [])));
  const links = await ensureStepLinks(scenarioId, step.id, urls);
  let body = personalized;
  for (const [url, linkId] of links) {
    body = body.split(url).join(`${siteUrl}/api/scenario/click?l=${linkId}&m=${m.id}`);
  }
  if (step.channel_chat) {
    const cid = await ensureConversation(m.id);
    if (cid != null) {
      await supabaseAdmin.from("chat_messages").insert({ conversation_id: cid, sender_member_id: null, sender_side: "staff", body });
      const snip = body.length > 60 ? `${body.slice(0, 60)}…` : body;
      await supabaseAdmin.from("chat_conversations").update({ last_message_at: new Date().toISOString(), last_message_snip: snip }).eq("id", cid);
    }
  }
  if (step.channel_email && isEmailConfigured() && m.email) {
    try { await sendMail({ to: m.email, subject: "KAWAI CAMP からのお知らせ", text: body, html: toHtml(body) }); } catch { /* 個別失敗は継続 */ }
  }
}

// ── 配信（期限が来たステップを送る）───────────────────────────
async function deliverDue(): Promise<number> {
  const now = Date.now();
  const members = await loadMembers();
  const byId = new Map(members.map((m) => [m.id, m]));
  const sourceIndex = await loadSourceIndex();
  const sourceLabel = (id: number | null | undefined) => (id == null ? "" : sourceIndex.get(id)?.label ?? "");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const { data: entries } = await supabaseAdmin.from("scenario_entries").select("*").eq("status", "active");
  if (!entries || entries.length === 0) return 0;

  // シナリオごとのステップをキャッシュ
  const stepsCache = new Map<number, Tables_scenario_steps[]>();
  const getSteps = async (sid: number) => {
    if (stepsCache.has(sid)) return stepsCache.get(sid)!;
    const { data } = await supabaseAdmin.from("scenario_steps").select("*").eq("scenario_id", sid).order("sort_order");
    const arr = (data ?? []) as Tables_scenario_steps[];
    stepsCache.set(sid, arr);
    return arr;
  };

  let sent = 0;
  for (const e of entries) {
    const steps = await getSteps(e.scenario_id);
    if (e.next_step >= steps.length) { await supabaseAdmin.from("scenario_entries").update({ status: "done" }).eq("id", e.id); continue; }
    const step = steps[e.next_step];
    const due = dueTime(e.entered_at, step.delay_unit ?? "immediate", step.delay_value ?? 0, step.time_of_day ?? null);
    if (due.getTime() > now) continue; // まだ

    const m = byId.get(e.member_id);
    if (m && !m.isDeleted) await sendStep(e.scenario_id, step, m, sourceLabel, siteUrl);

    const nextIndex = e.next_step + 1;
    const done = nextIndex >= steps.length;
    await supabaseAdmin.from("scenario_entries").update({ next_step: nextIndex, status: done ? "done" : "active", last_sent_at: new Date().toISOString() }).eq("id", e.id);
    sent += 1;
  }
  return sent;
}

// 型の別名（select("*") の行）
type Tables_scenario_steps = {
  id: number; scenario_id: number; sort_order: number; delay_unit: string; delay_value: number;
  time_of_day: string | null; channel_chat: boolean; channel_email: boolean; message_body: string;
};

export async function runScenarioCron(): Promise<{ enrolled: number; sent: number }> {
  const enrolled = await enroll();
  const sent = await deliverDue();
  return { enrolled, sent };
}

/** 手動エントリー（手動トリガー用） */
export async function enrollMember(scenarioId: number, memberId: number): Promise<void> {
  await supabaseAdmin.from("scenario_entries").upsert({ scenario_id: scenarioId, member_id: memberId, next_step: 0, status: "active" }, { onConflict: "scenario_id,member_id" });
}
