// ============================================================
// イベント・予定のデータ層（取得・保存・公開判定・フォーム連携）
//
//   ・公開対象は属性ABC＋公開条件。判定は contents.ts の canView をそのまま再利用する。
//   ・出欠テーブルは持たない。申込はイベントに紐付けた「フォーム」で受け、
//     回答済／未回答は form_submissions.member_id と公開対象メンバーの差分で算出する。
// ============================================================
import { supabase } from "./supabase";
import { canView } from "./contents";
import type { Tables } from "./database.types";
import type { CalEvent, EventKind, PublishMode, Member } from "./models";
import type { AttrIndex } from "./members";

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";
const asKind = (s: string | null | undefined): EventKind =>
  (s === "meeting" || s === "deadline" || s === "other") ? s : "event";

// timestamptz(ISO) → datetime-local 文字列（"YYYY-MM-DDTHH:mm"）
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
// datetime-local → ISO
const toIso = (local: string): string => {
  const d = new Date(local);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/** "YYYY-MM-DD"（カレンダーのセルキー） */
export const dayKey = (local: string): string => (local || "").slice(0, 10);

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchEvents(): Promise<CalEvent[]> {
  const [{ data, error }, { data: ea, error: e2 }] = await Promise.all([
    supabase.from("events").select("*").eq("is_deleted", false).order("start_at"),
    supabase.from("event_attributes").select("*"),
  ]);
  if (error) { console.warn("events 取得エラー（マイグレーション未適用の可能性）:", error); return []; }
  if (e2) console.warn("event_attributes 取得エラー:", e2);

  const attrMap = new Map<number, number[]>();
  (ea ?? []).forEach((r) => { const a = attrMap.get(r.event_id) ?? []; a.push(r.attribute_id); attrMap.set(r.event_id, a); });

  return (data ?? []).map((r: Tables<"events">): CalEvent => ({
    id: r.id,
    title: r.title ?? "",
    kind: asKind(r.kind),
    color: r.color || "#0d9488",
    allDay: r.all_day ?? false,
    startAt: toLocalInput(r.start_at),
    endAt: toLocalInput(r.end_at),
    location: r.location ?? "",
    url: r.url ?? "",
    bodyText: r.body_text ?? "",
    published: r.published ?? true,
    newsId: r.news_id ?? null,
    formId: r.form_id ?? null,
    showFormDeadline: r.show_form_deadline ?? true,
    attrMode: asMode(r.attr_mode),
    attrIds: attrMap.get(r.id) ?? [],
    createdAt: r.created_at ?? "",
  }));
}

// ── 保存 ──────────────────────────────────────────────────────
async function replaceAttrs(eventId: number, attrIds: number[]) {
  await supabase.from("event_attributes").delete().eq("event_id", eventId);
  if (attrIds.length) {
    await supabase.from("event_attributes").insert(attrIds.map((id) => ({ event_id: eventId, attribute_id: id })));
  }
}

export async function saveEvent(e: CalEvent): Promise<number | null> {
  const row = {
    title: e.title, kind: e.kind, color: e.color, all_day: e.allDay,
    start_at: toIso(e.startAt), end_at: toIso(e.endAt || e.startAt),
    location: e.location, url: e.url, body_text: e.bodyText,
    published: e.published, news_id: e.newsId, form_id: e.formId,
    show_form_deadline: e.showFormDeadline, attr_mode: e.attrMode,
  };
  if (e.id) {
    const { error } = await supabase.from("events").update(row).eq("id", e.id);
    if (error) { console.error(error); return null; }
    await replaceAttrs(e.id, e.attrIds);
    return e.id;
  }
  const { data, error } = await supabase.from("events").insert(row).select("id").single();
  if (error || !data) { console.error(error); return null; }
  await replaceAttrs(data.id, e.attrIds);
  return data.id;
}

export async function deleteEvent(id: number): Promise<void> {
  await supabase.from("events").update({ is_deleted: true }).eq("id", id);
}
export async function setEventPublished(id: number, published: boolean): Promise<void> {
  await supabase.from("events").update({ published }).eq("id", id);
}
/** お知らせに紐づく予定を削除（お知らせ側でチェックを外したとき） */
export async function deleteEventsByNews(newsId: number): Promise<void> {
  await supabase.from("events").update({ is_deleted: true }).eq("news_id", newsId);
}

// ── フォーム連携 ──────────────────────────────────────────────
/** カレンダー／イベント詳細で使うフォームの要約 */
export interface FormBrief {
  id: number;
  name: string;
  slug: string;
  status: string;          // draft | published | closed
  deadlineAt: string;      // datetime-local 文字列（"" = 期限なし）
  showOnCalendar: boolean;
  calendarLabel: string;
}

export async function fetchFormBriefs(): Promise<FormBrief[]> {
  const { data, error } = await supabase
    .from("forms").select("id, name, slug, status, deadline_at, show_on_calendar, calendar_label")
    .order("id", { ascending: false });
  if (error) { console.warn("forms 取得エラー:", error); return []; }
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name ?? "", slug: r.slug, status: r.status ?? "draft",
    deadlineAt: toLocalInput(r.deadline_at), showOnCalendar: r.show_on_calendar ?? false,
    calendarLabel: r.calendar_label ?? "",
  }));
}

/** フォームID → 回答済メンバーIDの集合（未ログイン回答＝member_id null は除外） */
export async function fetchAnsweredMembers(): Promise<Map<number, Set<number>>> {
  const { data, error } = await supabase.from("form_submissions").select("form_id, member_id");
  const map = new Map<number, Set<number>>();
  if (error) { console.warn("form_submissions 取得エラー:", error); return map; }
  (data ?? []).forEach((r) => {
    if (r.member_id == null) return;
    const s = map.get(r.form_id) ?? new Set<number>();
    s.add(r.member_id);
    map.set(r.form_id, s);
  });
  return map;
}

/** カレンダーに出す「フォームの回答期限」1件分 */
export interface FormDeadline {
  formId: number;
  label: string;
  slug: string;
  day: string;             // "YYYY-MM-DD"
  deadlineAt: string;
  answered: boolean;       // 自分が回答済みか
  /** イベント経由で表示されているか（イベントに紐付いたフォーム） */
  viaEvent: boolean;
}

/**
 * カレンダーに表示するフォーム締切を組み立てる。
 *   ① forms.show_on_calendar が ON のもの
 *   ② イベントに紐付き、show_form_deadline が ON のもの（イベントが見える人にだけ）
 * 公開中（published）かつ期限ありのフォームのみ。
 */
export function buildFormDeadlines(
  forms: FormBrief[], events: CalEvent[], answered: Map<number, Set<number>>, myId: number | null,
): FormDeadline[] {
  const linked = new Map<number, boolean>();   // formId → イベント経由か
  events.forEach((e) => { if (e.formId && e.showFormDeadline) linked.set(e.formId, true); });

  const out: FormDeadline[] = [];
  const seen = new Set<number>();
  for (const f of forms) {
    const viaEvent = linked.has(f.id);
    if (!f.showOnCalendar && !viaEvent) continue;
    if (f.status !== "published" || !f.deadlineAt) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({
      formId: f.id,
      label: f.calendarLabel || f.name || "フォーム",
      slug: f.slug,
      day: dayKey(f.deadlineAt),
      deadlineAt: f.deadlineAt,
      answered: myId != null && (answered.get(f.id)?.has(myId) ?? false),
      viaEvent,
    });
  }
  return out;
}

// ── 公開判定 ──────────────────────────────────────────────────
/** その会員が見られる公開中のイベント（運営は seeAll=true で全件） */
export function visibleEvents(
  all: CalEvent[], memberAttrIds: number[], index: AttrIndex, seeAll = false,
): CalEvent[] {
  return all
    .filter((e) => seeAll || e.published)
    .filter((e) => seeAll || canView(e.attrIds, e.attrMode, memberAttrIds, index));
}

/** イベントの公開対象メンバー（運営・削除済は除外しない：呼び出し側で audience を絞る） */
export function eventTargets(e: CalEvent, audience: Member[], index: AttrIndex): Member[] {
  return audience.filter((m) => canView(e.attrIds, e.attrMode, m.attrIds ?? [], index));
}

/** 紐付けフォームの回答状況（対象者・回答済・未回答） */
export interface EventFormStat {
  targets: Member[];
  answeredMembers: Member[];
  unanswered: Member[];
  pct: number;
}
export function eventFormStat(
  e: CalEvent, audience: Member[], index: AttrIndex, answered: Map<number, Set<number>>,
): EventFormStat {
  const targets = eventTargets(e, audience, index);
  const set = e.formId != null ? (answered.get(e.formId) ?? new Set<number>()) : new Set<number>();
  const answeredMembers = targets.filter((m) => set.has(m.id));
  const unanswered = targets.filter((m) => !set.has(m.id));
  return {
    targets, answeredMembers, unanswered,
    pct: targets.length === 0 ? 0 : Math.round((answeredMembers.length / targets.length) * 100),
  };
}

// ── 表示ヘルパー ──────────────────────────────────────────────
/** 新規イベントのひな形 */
export function emptyEvent(day?: string): CalEvent {
  const base = day || new Date().toISOString().slice(0, 10);
  return {
    id: 0, title: "", kind: "event", color: "#0d9488", allDay: false,
    startAt: `${base}T10:00`, endAt: `${base}T11:00`,
    location: "", url: "", bodyText: "", published: true,
    newsId: null, formId: null, showFormDeadline: true,
    attrMode: "any", attrIds: [], createdAt: "",
  };
}

/** 「8/12 09:00 〜 8/14 16:00」形式 */
export function eventRangeLabel(e: CalEvent): string {
  const f = (s: string, withTime: boolean) => {
    const [d, t] = (s || "").split("T");
    const [, m, dd] = (d || "").split("-");
    return withTime ? `${Number(m)}/${Number(dd)} ${t ?? ""}` : `${Number(m)}/${Number(dd)}`;
  };
  const sameDay = dayKey(e.startAt) === dayKey(e.endAt);
  if (e.allDay) return sameDay ? `${f(e.startAt, false)} 終日` : `${f(e.startAt, false)} 〜 ${f(e.endAt, false)} 終日`;
  return sameDay ? `${f(e.startAt, true)} 〜 ${(e.endAt || "").slice(11, 16)}` : `${f(e.startAt, true)} 〜 ${f(e.endAt, true)}`;
}

/** 期間の日数（1日イベントなら1） */
export function eventDays(e: CalEvent): number {
  const s = new Date(`${dayKey(e.startAt)}T00:00`).getTime();
  const t = new Date(`${dayKey(e.endAt || e.startAt)}T00:00`).getTime();
  if (isNaN(s) || isNaN(t)) return 1;
  return Math.max(1, Math.round((t - s) / 86400000) + 1);
}
