// ============================================================
// 運営ダッシュボード（/ops）の集約
//
//   「今、返していないものは何件あるか」「問合せは増えているか」を
//   1画面で出すための集約レイヤ。REQ-027。
//
//   ⚠️ 運営専用（RLS = is_ops）。service_role（supabaseAdmin）は使わない。
//      このモジュールはクライアントから import される＝クライアント安全に保つこと。
//
//   ⚠️ 旧 lib/summary.ts を吸収したもの。summary.ts は _to_delete/ へ退避済み。
//      チャネル別の未対応（ポータルトーク／メール／LINE）は同じ考え方を引き継ぎ、
//      フォーム・決済・名寄せ・問合せ推移を足している。
//
//   ⚠️ 未読（トーク／LINE）の総数は app.tsx が既に取得してサイドバーのバッジに
//      使っている。ここで取り直すと「サイドバーは9・ダッシュボードは11」が
//      同時に見える。総数は app.tsx の値を渡してもらい、ここでは
//      「アカウント別の内訳」だけを集計する（fetchOpsDashboard の引数を参照）。
// ============================================================
import { supabase } from "./supabase";
import { errMessage } from "./errors";
import { fetchAccounts as fetchMailAccounts } from "./mail";
import { fetchLineAccounts } from "./lineAccounts";
import { fetchLineFriends, fetchLineUnreadMap, fetchLineLinkQueue } from "./line";

// ── 型 ────────────────────────────────────────────────────────
export interface ChannelRow {
  /** 一意キー（React の key／遷移先の判定に使う） */
  key: string;
  /** 遷移先の view キー */
  view: string;
  kind: "portal" | "mail" | "line" | "form";
  title: string;
  desc: string;
  /** 右側に出す母数（登録者・友だち等）。null なら出さない */
  people: number | null;
  peopleLabel: string;
  unhandled: number;
  /**
   * 「自分の担当のみ」表示のとき、担当者の概念が無いため集計対象外になった行。
   * ⚠️ 0件として出すと「自分の担当は0件」と誤読される。必ず「—」で出すこと。
   */
  scopedOut?: boolean;
}

export interface WaitingItem {
  id: number;
  /** 遷移先のパス（静的ルートを含むため view キーではなくパスで持つ） */
  href: string;
  title: string;
  desc: string;
  /** 経過ミリ秒 */
  elapsedMs: number;
  assignee: string;
}

export interface TrendPoint {
  /** JST の YYYY-MM-DD */
  day: string;
  count: number;
}

export interface OpsDashboard {
  /** 未対応：チャネル別の内訳 */
  channels: ChannelRow[];
  /** 未対応：合計（channels の合計と一致する） */
  unhandledTotal: number;
  /** 最も古い未対応（フォーム）。無ければ null */
  oldest: WaitingItem | null;
  /** 待たせている順 Top5（P2-a） */
  waiting: WaitingItem[];
  /** 今日のフォーム回答（JST） */
  todayForms: number;
  /** 昨日のフォーム回答（JST）。前日比の表示に使う */
  yesterdayForms: number;
  /** 未照合の決済 */
  unmatchedPayments: number;
  /** 未照合決済のうち最も古いものの経過ミリ秒。無ければ null */
  oldestPaymentMs: number | null;
  /** LINE 名寄せ 要対応 */
  linkQueue: number;
  /** 問合せ推移（フォームのみ・日次・JST） */
  trend: TrendPoint[];
  /** メールアカウントが1件も連携されていない */
  noMailAccounts: boolean;
  /** LINEアカウントが1件も連携されていない */
  noLineAccounts: boolean;
  /** 一部の取得に失敗した（取れた分は表示し、上部に赤帯を出す） */
  partial: boolean;
}

/** ダッシュボードが受け取る「既に取得済みの未読総数」（app.tsx から） */
export interface UnreadTotals {
  portal: number;
  line: number;
}

// ── JST の日付ユーティリティ ──────────────────────────────────
//   submitted_at は timestamptz（UTC 保存）。UTC のまま日次に畳むと
//   日本時間の朝9時までが前日扱いになる。日付キーは必ず JST で作る。

/** Date → JST の "YYYY-MM-DD" */
export function jstDayKey(d: Date): string {
  // sv-SE ロケールは "YYYY-MM-DD" を返す
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST の「今日の 00:00」を表す Date（UTC の瞬間） */
export function jstStartOfToday(now: Date = new Date()): Date {
  const key = jstDayKey(now);
  // JST は UTC+9 固定（夏時間なし）
  return new Date(`${key}T00:00:00+09:00`);
}

/** JST で n 日前の 00:00 */
export function jstStartOfDaysAgo(n: number, now: Date = new Date()): Date {
  return new Date(jstStartOfToday(now).getTime() - n * 86_400_000);
}

/** 経過ミリ秒 → 「2日 4時間」「22時間」「14分」 */
export function elapsedLabel(ms: number): string {
  if (ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}分`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間`;
  const day = Math.floor(hour / 24);
  const rest = hour % 24;
  return rest > 0 ? `${day}日 ${rest}時間` : `${day}日`;
}

// ── 個別の取得 ────────────────────────────────────────────────

/** フォームの未対応件数（status = 'new'）。行は引かない */
async function countNewSubmissions(assigneeId: number | null): Promise<number> {
  let q = supabase
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (assigneeId != null) q = q.eq("assignee_id", assigneeId);
  const { count } = await q;
  return count ?? 0;
}

/** 未照合の決済件数 */
async function countUnmatchedPayments(): Promise<{ count: number; oldestMs: number | null }> {
  const { count } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "unmatched")
    .eq("is_deleted", false);
  const { data } = await supabase
    .from("payments")
    .select("created_at")
    .eq("status", "unmatched")
    .eq("is_deleted", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const oldestMs = data?.created_at ? Date.now() - Date.parse(data.created_at) : null;
  return { count: count ?? 0, oldestMs };
}

/** JST の当日 0:00 以降のフォーム回答数 */
async function countFormsSince(from: Date, to: Date | null, assigneeId: number | null): Promise<number> {
  let q = supabase
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .gte("submitted_at", from.toISOString());
  if (to) q = q.lt("submitted_at", to.toISOString());
  if (assigneeId != null) q = q.eq("assignee_id", assigneeId);
  const { count } = await q;
  return count ?? 0;
}

/**
 * 問合せ推移（フォームのみ・日次）。
 *
 * ⚠️ PostgREST の既定 max_rows は 1000。range() を付けずに投げると
 *    1000件を超えた分が黙って切り捨てられ、グラフが静かに間違う。
 *    ここでは 1000件ずつページングして全件を取り切る。
 *    （将来 RPC 化する場合はこの関数の中身だけ差し替えればよい）
 */
async function fetchTrend(days: number, assigneeId: number | null, now: Date = new Date()): Promise<TrendPoint[]> {
  const from = jstStartOfDaysAgo(days - 1, now);

  const PAGE = 1000;
  const stamps: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("form_submissions")
      .select("submitted_at")
      .gte("submitted_at", from.toISOString())
      .order("submitted_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (assigneeId != null) q = q.eq("assignee_id", assigneeId);
    const { data, error } = await q;
    if (error || !data) break;
    for (const r of data) if (r.submitted_at) stamps.push(r.submitted_at);
    if (data.length < PAGE) break;
  }

  const bucket = new Map<string, number>();
  for (const s of stamps) {
    const key = jstDayKey(new Date(s));
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  // 0件の日も棒を出す（欠測と0を見分けられるようにする）
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = jstDayKey(new Date(jstStartOfDaysAgo(i, now).getTime() + 1000));
    out.push({ day, count: bucket.get(day) ?? 0 });
  }
  return out;
}

/** 待たせている順（P1 はフォームのみ。P2 でチャネル横断へ広げる） */
async function fetchWaiting(limit: number, assigneeId: number | null): Promise<WaitingItem[]> {
  let q = supabase
    .from("form_submissions")
    .select("id, form_id, guest_name, member_id, assignee_id, submitted_at")
    .eq("status", "new")
    .order("submitted_at", { ascending: true })
    .limit(limit);
  if (assigneeId != null) q = q.eq("assignee_id", assigneeId);
  const { data } = await q;
  if (!data || data.length === 0) return [];

  // フォーム名を引く（件数が少ないので in で一括）
  const formIds = Array.from(new Set(data.map((r) => r.form_id)));
  const { data: forms } = await supabase
    .from("forms")
    .select("id, name")
    .in("id", formIds.length ? formIds : [-1]);
  const nameById = new Map((forms ?? []).map((f) => [f.id, f.name ?? ""]));

  const now = Date.now();
  return data.map((r) => ({
    id: r.id,
    href: `/ops/submissions/${r.id}`,
    title: (r.guest_name ?? "").trim() || (r.member_id != null ? `会員 #${r.member_id}` : "名前未入力"),
    desc: `フォーム「${nameById.get(r.form_id) ?? "—"}」`,
    elapsedMs: r.submitted_at ? now - Date.parse(r.submitted_at) : 0,
    assignee: r.assignee_id == null ? "" : String(r.assignee_id),
  }));
}

// ── 本体 ──────────────────────────────────────────────────────

export interface FetchOpsDashboardOptions {
  /** 推移グラフの日数（7 / 14 / 30） */
  days: number;
  /** app.tsx が既に持っている未読総数。数字の正本を1つにするため受け取る */
  unread: UnreadTotals;
  /** 待たせている順の表示件数 */
  waitingLimit?: number;
  /**
   * 「自分の担当のみ」で絞るときの members.id。null なら全体。
   * ⚠️ 担当者を持つのはフォーム回答だけ。トーク／メール／LINE は担当の概念が
   *    無いため、絞り込み時は集計対象外（scopedOut）にして「—」で出す。
   */
  assigneeId?: number | null;
}

export async function fetchOpsDashboard(opts: FetchOpsDashboardOptions): Promise<OpsDashboard> {
  const { days, unread, waitingLimit = 5, assigneeId = null } = opts;
  const mine = assigneeId != null;
  const now = new Date();
  const todayStart = jstStartOfToday(now);
  const yesterdayStart = jstStartOfDaysAgo(1, now);

  // ⚠️ Promise.all だと1つコケた時点で全部が落ちる。allSettled で受け、
  //    落ちたブロックだけを空にして、他は表示する。
  const settled = await Promise.allSettled([
    countNewSubmissions(assigneeId),                             // 0
    fetchMailAccounts(),                                         // 1
    fetchLineAccounts(),                                         // 2
    fetchLineFriends(),                                          // 3
    countFormsSince(todayStart, null, assigneeId),               // 4
    countFormsSince(yesterdayStart, todayStart, assigneeId),     // 5
    countUnmatchedPayments(),                                    // 6
    fetchLineLinkQueue(null),                                    // 7
    fetchTrend(days, assigneeId, now),                           // 8
    fetchWaiting(waitingLimit, assigneeId),                      // 9
  ]);

  // ⚠️ rejected は握り潰さない。errMessage で文言を取り出して警告に残す
  //    （develop.md §12：catch (e: any)・握り潰しは禁止）。
  for (const r of settled) {
    if (r.status === "rejected") console.warn("ダッシュボードの一部取得に失敗:", errMessage(r.reason, "取得に失敗しました"));
  }
  const partial = settled.some((r) => r.status === "rejected");

  function val<T>(i: number, fallback: T): T {
    const r = settled[i];
    if (r.status !== "fulfilled") return fallback;
    const v = r.value as T | null | undefined;
    return v ?? fallback;
  }

  const formUnhandled = val<number>(0, 0);
  const mailAccts     = val<Awaited<ReturnType<typeof fetchMailAccounts>>>(1, []);
  const lineAccts     = val<Awaited<ReturnType<typeof fetchLineAccounts>>>(2, []);
  const friends       = val<Awaited<ReturnType<typeof fetchLineFriends>>>(3, []);
  const todayForms    = val<number>(4, 0);
  const yesterdayForms = val<number>(5, 0);
  const pay           = val<{ count: number; oldestMs: number | null }>(6, { count: 0, oldestMs: null });
  const queue         = val<Awaited<ReturnType<typeof fetchLineLinkQueue>>>(7, []);
  const trend         = val<TrendPoint[]>(8, []);
  const waiting       = val<WaitingItem[]>(9, []);

  // LINE：友だち数・未対応数をアカウント別に集計（旧 summary.ts から移植）
  const unreadMap = friends.length > 0 ? await fetchLineUnreadMap(friends).catch(() => ({})) : {};
  const friendsByAcct = new Map<number, number>();
  const unreadByAcct  = new Map<number, number>();
  for (const f of friends) {
    if (f.accountId == null) continue;
    if (f.status === "friend") friendsByAcct.set(f.accountId, (friendsByAcct.get(f.accountId) ?? 0) + 1);
    const u = (unreadMap as Record<number, number>)[f.id] ?? 0;
    if (u > 0) unreadByAcct.set(f.accountId, (unreadByAcct.get(f.accountId) ?? 0) + u);
  }

  const channels: ChannelRow[] = [
    {
      key: "portal", view: "chat", kind: "portal",
      title: "ポータルトーク", desc: "会員ポータル内トーク",
      people: null, peopleLabel: "",
      unhandled: mine ? 0 : unread.portal, scopedOut: mine,
    },
    ...mailAccts.map((a): ChannelRow => ({
      key: `mail-${a.id}`, view: "mailbox", kind: "mail",
      title: a.address, desc: a.displayName || "",
      people: null, peopleLabel: "",
      unhandled: mine ? 0 : a.unread, scopedOut: mine,
    })),
    ...lineAccts.map((a): ChannelRow => ({
      key: `line-${a.id}`, view: "line", kind: "line",
      title: a.name, desc: a.basicId ? `@${a.basicId.replace(/^@/, "")}` : "",
      people: friendsByAcct.get(a.id) ?? 0, peopleLabel: "友だち",
      unhandled: mine ? 0 : (unreadByAcct.get(a.id) ?? 0), scopedOut: mine,
    })),
    {
      key: "form", view: "form", kind: "form",
      title: "フォーム回答（未対応）", desc: "status = new の回答",
      people: null, peopleLabel: "",
      unhandled: formUnhandled,
    },
  ];

  // 合計は「サイドバーのバッジと同じ値（portal / line）」＋ メール ＋ フォーム。
  // ⚠️ LINE は内訳の合計ではなく app.tsx が持つ総数を使う。
  //    アカウント未設定の友だちが内訳から漏れるため、合計が食い違うのを防ぐ。
  // ⚠️ 「自分の担当のみ」のときは担当者を持つフォームだけが対象。
  const mailUnhandled = mailAccts.reduce((s, a) => s + a.unread, 0);
  const unhandledTotal = mine
    ? formUnhandled
    : unread.portal + unread.line + mailUnhandled + formUnhandled;

  return {
    channels,
    unhandledTotal,
    oldest: waiting[0] ?? null,
    waiting,
    todayForms,
    yesterdayForms,
    unmatchedPayments: pay.count,
    oldestPaymentMs: pay.oldestMs,
    linkQueue: queue.length,
    trend,
    noMailAccounts: mailAccts.length === 0,
    noLineAccounts: lineAccts.length === 0,
    partial,
  };
}
