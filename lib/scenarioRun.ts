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
import { loadStaffRoleKeys } from "./rolesServer";
import { sendMail, isEmailConfigured } from "./email";
import { sendMailFromAccount } from "./mailServer";
import { loadSuppressedSets, isSuppressed, buildUnsubscribe } from "./suppressionServer";
import { resolveListAudienceServer, recordListDeliveries } from "./listRecipientsServer";
import { normalizeEmail } from "./emailNormalize";

/** 配信停止の照合に使う集合（生の小文字 ＋ 正規化値） */
type SuppressionSets = { raw: Set<string>; norm: Set<string> };
import { ensureConversation, postChatMessage } from "./chatServer";
import { sendLineToMember, sendLineRichToMember, getAccountLiffId, lineDeliveryToken } from "./lineBroadcastServer";
import { toLineMessages, isRichMessageEmpty, richMessageSummary } from "./lineRichMessage";
import type { Member, RichMessage, SourceCategory } from "./models";

type MemberX = Member & { welcomedAt: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(t).replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</div>`;

async function loadMembers(): Promise<MemberX[]> {
  const { data: rows } = await supabaseAdmin
    .from("members")
    .select("id, name, role, email, company, kana, prefecture, source_id, user_id, is_deleted, welcomed_at");
  const { data: attrs } = await supabaseAdmin.from("member_attributes").select("member_id, attribute_id").not("member_id", "is", null);
  const byMember = new Map<number, number[]>();
  for (const a of attrs ?? []) { if (a.member_id == null) continue; const arr = byMember.get(a.member_id) ?? []; arr.push(a.attribute_id); byMember.set(a.member_id, arr); }
  return (rows ?? []).map((r) => ({
    id: r.id, name: r.name, role: r.role ?? "メンバー", userId: r.user_id ?? null,
    email: r.email ?? "", company: r.company ?? "", chatId: "", isDeleted: r.is_deleted ?? false,
    kana: r.kana ?? "", tel: "", prefecture: r.prefecture ?? "", sourceId: r.source_id ?? null,
    attrIds: byMember.get(r.id) ?? [], memos: [], welcomedAt: r.welcomed_at ?? null,
  }));
}

/**
 * 配信対象の顧客か（運営スタッフは除外）。
 *
 * ⚠️ staffKeys にはオペレーターの派生ロールも含まれる。
 *    loadStaffRoleKeys() の結果を必ず渡すこと。渡さないと
 *    派生ロールのスタッフがシナリオ配信の宛先に混入する。
 */
const isCustomer = (m: MemberX, staffKeys: ReadonlySet<string>) =>
  !m.isDeleted && !staffKeys.has(m.role ?? "");

/** Phase 3：流入経路は複数 id の OR ＋ カテゴリ一括で判定する */
type AttrMode = "any" | "all" | "exany" | "exall";
function matchTarget(
  m: MemberX,
  sourceIds: number[], sourceCats: SourceCategory[], targetAttrIds: number[],
  attrMode: AttrMode,
  index: SourceIndex,
): boolean {
  if (!matchSource(m.sourceId, { targetSourceIds: sourceIds, targetSourceCats: sourceCats }, index)) return false;
  if (targetAttrIds.length > 0) {
    const ids = m.attrIds ?? [];
    const anyMatch = targetAttrIds.some((id) => ids.includes(id));
    const allMatch = targetAttrIds.every((id) => ids.includes(id));
    // STEP2：一斉配信と同じ4モード（any/all/exany/exall）で判定する。
    if (attrMode === "any"   && !anyMatch) return false;
    if (attrMode === "all"   && !allMatch) return false;
    if (attrMode === "exany" &&  anyMatch) return false;
    if (attrMode === "exall" &&  allMatch) return false;
  }
  return true;
}

/**
 * リスト宛シナリオへの投入（Cron から毎回呼ばれる）。
 *
 *   確定事項 A1=a：リストに**後から追加された人も**シナリオを開始する。
 *   そのため保存時の一括投入だけでなく、ここで差分を拾い続ける。
 *
 *   ⚠️ 投入するのは「実際に送れる宛先」だけ（電話のみ・配信停止・重複・形式不正を除外）。
 *      除外の規則は一斉配信と同じ resolveListAudienceServer() に集約している。
 *   ⚠️ 既存エントリーは正規化メールで照合する。DB の索引は lower(email) なので、
 *      Gmail のドット表記違いは索引では弾けない（同じ人へ2通いく）。
 */
async function enrollFromLists(sc: {
  id: number; name: string | null; target_list_ids: number[] | null;
}): Promise<number> {
  const listIds = Array.isArray(sc.target_list_ids) ? sc.target_list_ids : [];
  if (listIds.length === 0) return 0;

  const audience = await resolveListAudienceServer(listIds, true);
  if (audience.recipients.length === 0) return 0;

  const { data: rows } = await supabaseAdmin
    .from("scenario_entries").select("email").eq("scenario_id", sc.id).not("email", "is", null);
  const already = new Set(
    (rows ?? [])
      .map((r) => (r.email ?? "").trim())
      .filter(Boolean)
      .map((e) => normalizeEmail(e) ?? e.toLowerCase()),
  );

  const toAdd = audience.recipients.filter((r) => !already.has(r.emailNorm));
  if (toAdd.length === 0) return 0;

  // リスト別の投入実績（配信履歴に残す）
  const byList = new Map<number, number>();
  let added = 0;
  for (let i = 0; i < toAdd.length; i += 500) {
    const chunk = toAdd.slice(i, i + 500);
    const payload = chunk.map((r) => ({
      scenario_id: sc.id, member_id: r.memberId, email: r.email, next_step: 0, status: "active",
    }));
    const { error } = await supabaseAdmin.from("scenario_entries").insert(payload);
    if (!error) {
      added += chunk.length;
      for (const r of chunk) byList.set(r.listId, (byList.get(r.listId) ?? 0) + 1);
      continue;
    }
    for (const r of chunk) {
      const { error: e1 } = await supabaseAdmin.from("scenario_entries").insert({
        scenario_id: sc.id, member_id: r.memberId, email: r.email, next_step: 0, status: "active",
      });
      if (!e1) { added += 1; byList.set(r.listId, (byList.get(r.listId) ?? 0) + 1); }
    }
  }

  // 「このリストがシナリオに使われた」履歴を残す（投入があったときだけ）
  if (added > 0) {
    const used = audience.perList.filter((p) => (byList.get(p.listId) ?? 0) > 0);
    await recordListDeliveries({
      perList: used, kind: "scenario", scenarioId: sc.id,
      titleSnapshot: sc.name ?? "", channel: "email",
      actualSentByList: byList,
    });
  }
  return added;
}

// ── エンロール（自動トリガー）─────────────────────────────────
async function enroll(): Promise<number> {
  const { data: scenarios } = await supabaseAdmin.from("scenarios").select("*").eq("active", true);
  if (!scenarios || scenarios.length === 0) return 0;
  const members = await loadMembers();
  const sourceIndex = await loadSourceIndex();
  // 運営ロール（オペレーターの派生ロール含む）は配信対象外
  const staffKeys = await loadStaffRoleKeys();
  let enrolled = 0;

  for (const sc of scenarios) {
    // ── リスト宛（確定事項 A1=a）──────────────────────────
    //   「リストに追加された時点でシナリオを開始する」ため、trigger_type に
    //   関わらず毎回リストを見て、まだ入っていない宛先だけを投入する。
    //   ⚠️ 会員抽出（この下の候補選定）は絶対に通さない。通すと
    //      リスト宛シナリオが「会員向け」として解釈され、意図しない相手が入る。
    if (sc.audience_type === "list") {
      enrolled += await enrollFromLists(sc);
      continue;
    }
    if (sc.trigger_type === "manual") continue; // 手動は自動登録しない
    if (sc.audience_type === "email") continue; // 外部メールリストは保存時に投入済み（自動登録しない）
    const attrIds  = Array.isArray(sc.target_attr_ids) ? (sc.target_attr_ids as number[]) : [];
    const srcIds   = Array.isArray(sc.target_source_ids)  ? sc.target_source_ids : [];
    const srcCats  = Array.isArray(sc.target_source_cats) ? (sc.target_source_cats as SourceCategory[]) : [];
    const attrMode = (["any", "all", "exany", "exall"].includes(sc.attr_mode) ? sc.attr_mode : "any") as AttrMode;

    const { data: existing } = await supabaseAdmin.from("scenario_entries").select("member_id").eq("scenario_id", sc.id);
    const already = new Set((existing ?? []).map((e) => e.member_id));

    const candidates = members.filter((m) => {
      if (!isCustomer(m, staffKeys)) return false;
      if (already.has(m.id)) return false;
      if (!matchTarget(m, srcIds, srcCats, attrIds, attrMode, sourceIndex)) return false;
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

// ── 1ステップを1メンバーへ送信 ────────────────────────────────
async function sendStep(
  scenarioId: number,
  step: { id: number; channel_chat: boolean; channel_email: boolean; channel_line: boolean; message_body: string; message_json?: unknown; mail_subject?: string | null },
  m: MemberX, sourceLabel: (id: number | null | undefined) => string, siteUrl: string,
  lineAccountId: number | null,
  mailAccountId: number | null, subjectFallback: string,
  suppressed: SuppressionSets,
): Promise<void> {
  const personalized = renderMessage(step.message_body ?? "", m, sourceLabel);

  // ⚠️ チャットは素のURLのまま投稿する（chat_links で計測する）。
  //    メールだけ scenario_links の計測URLに置換する。二重リダイレクタを避けるため。
  if (step.channel_chat) {
    const cid = await ensureConversation(m.id);
    if (cid != null) await postChatMessage(cid, personalized, "scenario");
  }

  // LINE：会員ごとにPush（本文は差込済み）。連携済み友だちにのみ届く。履歴は残す。
  //   リッチメッセージ（message_json）があればそれを、無ければテキスト本文を送る。
  if (step.channel_line && lineAccountId != null) {
    const token = await lineDeliveryToken(lineAccountId);
    if (token) {
      const rich = step.message_json as RichMessage | null;
      if (rich && !isRichMessageEmpty(rich)) {
        const liffId = await getAccountLiffId(lineAccountId);
        await sendLineRichToMember(lineAccountId, token, m.id, toLineMessages(rich, liffId), richMessageSummary(rich));
      } else {
        await sendLineToMember(lineAccountId, token, m.id, personalized);
      }
    }
  }

  if (step.channel_email && (mailAccountId != null || isEmailConfigured()) && m.email && !isSuppressed(suppressed, m.email)) {
    const urls = Array.from(new Set((personalized.match(/https?:\/\/[^\s<>"']+/g) ?? [])));
    const links = await ensureStepLinks(scenarioId, step.id, urls);
    let body = personalized;
    for (const [url, linkId] of links) {
      body = body.split(url).join(`${siteUrl}/api/scenario/click?l=${linkId}&m=${m.id}`);
    }
    // STEP2：件名はステップ設定を優先し、未設定はフォールバック。送信元アカウント指定があればそのSMTP。
    const subject = (step.mail_subject ?? "").trim() || subjectFallback;
    // STEP3：配信停止フッター＋List-Unsubscribe を付与。
    const u = buildUnsubscribe(m.email, siteUrl);
    try {
      if (mailAccountId != null) {
        await sendMailFromAccount({ accountId: mailAccountId, to: m.email, subject, text: body + u.footerText, html: toHtml(body) + u.footerHtml, skipSent: true, listUnsubscribe: u.url });
      } else {
        await sendMail({ to: m.email, subject, text: body + u.footerText, html: toHtml(body) + u.footerHtml, listUnsubscribe: u.url });
      }
    } catch { /* 個別失敗は継続 */ }
  }
}

// ── 外部メールリスト宛先へ1ステップ送信（会員なし・メールのみ）───
//   会員情報が無いため差し込み変数は空。URLクリック計測は行わない（素のURL）。
async function sendExternalEmail(
  step: { channel_email: boolean; message_body: string; mail_subject?: string | null },
  email: string, siteUrl: string,
  mailAccountId: number | null, subjectFallback: string,
  suppressed: SuppressionSets,
): Promise<void> {
  if (!step.channel_email) return;                 // 外部リストはメールのみ
  if (!(mailAccountId != null || isEmailConfigured())) return;
  // ⚠️ 生の小文字だけで照合すると、Gmail のドット表記違いで停止済みの相手へ送ってしまう
  if (!email || isSuppressed(suppressed, email)) return;
  const rendered = renderMessage(step.message_body ?? "", { email }, () => "");
  const subject = (step.mail_subject ?? "").trim() || subjectFallback;
  const u = buildUnsubscribe(email, siteUrl);
  try {
    if (mailAccountId != null) {
      await sendMailFromAccount({ accountId: mailAccountId, to: email, subject, text: rendered + u.footerText, html: toHtml(rendered) + u.footerHtml, skipSent: true, listUnsubscribe: u.url });
    } else {
      await sendMail({ to: email, subject, text: rendered + u.footerText, html: toHtml(rendered) + u.footerHtml, listUnsubscribe: u.url });
    }
  } catch { /* 個別失敗は継続 */ }
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

  // 配信停止リスト（メール）。ステップ配信時に照合してメールをスキップする。
  const suppressed = await loadSuppressedSets();

  // シナリオごとのステップをキャッシュ
  const stepsCache = new Map<number, Tables_scenario_steps[]>();
  const getSteps = async (sid: number) => {
    if (stepsCache.has(sid)) return stepsCache.get(sid)!;
    const { data } = await supabaseAdmin.from("scenario_steps").select("*").eq("scenario_id", sid).order("sort_order");
    const arr = (data ?? []) as Tables_scenario_steps[];
    stepsCache.set(sid, arr);
    return arr;
  };
  // シナリオの送信元LINEアカウントをキャッシュ
  const lineAcctCache = new Map<number, number | null>();
  const getLineAccount = async (sid: number): Promise<number | null> => {
    if (lineAcctCache.has(sid)) return lineAcctCache.get(sid)!;
    const { data } = await supabaseAdmin.from("scenarios").select("line_account_id").eq("id", sid).maybeSingle();
    const v = data?.line_account_id ?? null;
    lineAcctCache.set(sid, v);
    return v;
  };
  // STEP2：シナリオの送信元メールアカウント・名称（件名フォールバック用）をキャッシュ
  const scMetaCache = new Map<number, { mailAccountId: number | null; name: string; active: boolean }>();
  const getScenarioMeta = async (sid: number): Promise<{ mailAccountId: number | null; name: string; active: boolean }> => {
    if (scMetaCache.has(sid)) return scMetaCache.get(sid)!;
    const { data } = await supabaseAdmin.from("scenarios").select("mail_account_id, name, active").eq("id", sid).maybeSingle();
    const v = { mailAccountId: data?.mail_account_id ?? null, name: data?.name ?? "", active: data?.active ?? false };
    scMetaCache.set(sid, v);
    return v;
  };

  let sent = 0;
  for (const e of entries) {
    const steps = await getSteps(e.scenario_id);
    const cur = e.next_step;
    if (cur >= steps.length) { await supabaseAdmin.from("scenario_entries").update({ status: "done" }).eq("id", e.id); continue; }
    const step = steps[cur];

    const meta = await getScenarioMeta(e.scenario_id);
    // 停止中のシナリオは配信も進行もしない（再開時に続きから送出）。UIの「停止中＝配信しない」と整合。
    if (!meta.active) continue;

    const branchType = step.branch_type ?? "none";
    const alreadySent = (e.sent_step ?? -1) >= cur;

    // ── フェーズ1：現在ステップを送信する ──
    if (!alreadySent) {
      const due = dueTime(e.entered_at, step.delay_unit ?? "immediate", step.delay_value ?? 0, step.time_of_day ?? null);
      if (due.getTime() > now) continue; // まだ
      const subjectFallback = meta.name ? `【${meta.name}】ステップ${cur + 1}` : "KAWAI CAMP からのお知らせ";
      if (e.member_id != null) {
        const m = byId.get(e.member_id);
        if (m && !m.isDeleted) {
          const lineAccountId = step.channel_line ? await getLineAccount(e.scenario_id) : null;
          await sendStep(e.scenario_id, step, m, sourceLabel, siteUrl, lineAccountId, meta.mailAccountId, subjectFallback, suppressed);
        }
      } else if (e.email) {
        // 外部メールリスト宛先（会員なし）：メールのみ・変数は会員情報が無いため空になる。
        await sendExternalEmail(step, e.email, siteUrl, meta.mailAccountId, subjectFallback, suppressed);
      }
      const nowIso = new Date().toISOString();
      if (branchType === "none") {
        // 分岐なし：即前進
        const nextIndex = cur + 1;
        const done = nextIndex >= steps.length;
        await supabaseAdmin.from("scenario_entries").update({ sent_step: cur, next_step: nextIndex, status: done ? "done" : "active", last_sent_at: nowIso }).eq("id", e.id);
      } else {
        // 分岐あり：送信済みだけ記録し、判定は待ち時間の経過後（フェーズ2）で行う
        await supabaseAdmin.from("scenario_entries").update({ sent_step: cur, last_sent_at: nowIso }).eq("id", e.id);
      }
      sent += 1;
      continue;
    }

    // ── フェーズ2：送信済み（分岐あり）。待ち時間経過後に分岐先を決める ──
    const waitMs = Math.max(0, step.branch_wait_hours ?? 24) * 3600_000;
    const decideAt = (e.last_sent_at ? new Date(e.last_sent_at).getTime() : now) + waitMs;
    if (decideAt > now) continue; // まだ判定待ち

    const cond = await evalBranch(step, e, byId);
    const target = cond ? step.branch_yes : step.branch_no; // -1=終了 / null=次へ
    let nextIndex: number;
    if (target == null) nextIndex = cur + 1;
    else if (target < 0) nextIndex = steps.length;      // シナリオ終了
    else if (target <= cur) nextIndex = cur + 1;        // 後戻りは不可（安全側）
    else nextIndex = target;
    const done = nextIndex >= steps.length;
    await supabaseAdmin.from("scenario_entries").update({ next_step: done ? steps.length : nextIndex, status: done ? "done" : "active" }).eq("id", e.id);
  }
  return sent;
}

// ── 分岐条件の評価 ────────────────────────────────────────────
async function evalBranch(
  step: { id: number; branch_type: string; branch_attr_ids: unknown },
  e: { member_id: number | null },
  byId: Map<number, MemberX>,
): Promise<boolean> {
  if (step.branch_type === "attr") {
    if (e.member_id == null) return false;              // 外部宛先は属性なし
    const ids = byId.get(e.member_id)?.attrIds ?? [];
    const want = Array.isArray(step.branch_attr_ids) ? (step.branch_attr_ids as number[]) : [];
    return want.length > 0 && want.some((id) => ids.includes(id));
  }
  if (step.branch_type === "click") {
    if (e.member_id == null) return false;              // 外部宛先はクリック計測なし
    return await memberClickedStep(step.id, e.member_id);
  }
  return false;
}

/** 会員がそのステップ本文のURLをクリックしたか（scenario_links × scenario_clicks）。 */
async function memberClickedStep(stepId: number, memberId: number): Promise<boolean> {
  const { data: links } = await supabaseAdmin.from("scenario_links").select("id").eq("step_id", stepId);
  const ids = (links ?? []).map((l) => l.id);
  if (ids.length === 0) return false;
  const { data: clicks } = await supabaseAdmin.from("scenario_clicks").select("id").in("link_id", ids).eq("member_id", memberId).limit(1);
  return (clicks ?? []).length > 0;
}

// 型の別名（select("*") の行）
type Tables_scenario_steps = {
  id: number; scenario_id: number; sort_order: number; delay_unit: string; delay_value: number;
  time_of_day: string | null; channel_chat: boolean; channel_email: boolean; channel_line: boolean; message_body: string;
  message_json: unknown; mail_subject: string | null;
  branch_type: string; branch_attr_ids: unknown; branch_yes: number | null; branch_no: number | null; branch_wait_hours: number;
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
