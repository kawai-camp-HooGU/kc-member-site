// ============================================================
// ChatWork 通知の共通ロジック（サーバー専用）
//   文面は「PJ毎の上書き → アプリ全体の既定 → コード既定」の順で解決。
//   見出し / 前文 / タスク行 / 末尾 の4パートを差込変数つきで展開。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  CAT_BY_KEY,
  renderTemplate,
  importanceLabel,
  resolveTextField,
  resolveEnabled,
  type TextOverride,
} from "./notifyCategories";

type DB = SupabaseClient<Database>;

/** アプリ全体設定（notify_settings を正規化したもの） */
export interface AppSetting {
  enabled: boolean;
  header: string;
  lead: string;
  taskLine: string;
  tail: string;
}
export type AppSettings = Record<string, AppSetting>;

/** 組み立て済み通知メッセージ */
export interface NotificationMsg {
  projectId: number;
  projectName: string;
  roomId: string;
  category: string;
  assigneeName: string | null;
  message: string;
}

/** 通知判定に必要なタスク列（部分select） */
interface NotifyTask {
  id: number;
  name: string;
  project_id: number;
  anken_id: number;
  end_date: string | null;
  status: string;
  assignee_ids: number[];
  importance: number | null;
}

export interface BuildOptions {
  includeEmpty?: boolean;
  appSettings?: AppSettings;
}

export function jstDateStr(offsetDays = 0): string {
  const t = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
export function jstWeekdayIndex(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
}
export function jstWeekdayLabel(): string {
  return WEEKDAY[jstWeekdayIndex()] ?? "";
}

export function parseRoomId(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = s.match(/rid(\d+)/i);
  if (m) return m[1] ?? null;
  if (/^\d+$/.test(s)) return s;
  return null;
}

export interface ChatworkResult { ok: boolean; status: number; text: string; }
export async function sendChatwork(
  token: string,
  roomId: string,
  message: string
): Promise<ChatworkResult> {
  const body = new URLSearchParams({ body: message, self_unread: "0" });
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "X-ChatWorkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// 曜日からその日に出すカテゴリ一覧（cron用）
export function categoriesForWeekday(idx: number = jstWeekdayIndex()): string[] {
  const daily = ["overdue3", "weekDue3", "todayDue3", "todayCp"];
  const imp12 = ["overdue12", "weekDue12", "todayDue12"];
  const imp0  = ["overdue0", "weekDue0", "todayDue0", "weekCp"];
  if (idx === 1) return [...daily, ...imp12, ...imp0];
  if (idx === 3 || idx === 5) return [...daily, ...imp12];
  return daily;
}

const impMatch = (t: NotifyTask, imp: string | null): boolean =>
  imp === "3" ? t.importance === 3 :
  imp === "12" ? (t.importance === 1 || t.importance === 2) :
  t.importance == null; // "0"

// ── アプリ全体の通知設定を取得し、カテゴリ→設定 のマップに正規化 ──
export async function fetchAppSettings(supabase: DB): Promise<AppSettings> {
  const { data, error } = await supabase.from("notify_settings").select("*");
  if (error) {
    if (process.env.NODE_ENV !== "production") console.warn("notify_settings 取得失敗:", error.message);
    return {};
  }
  const map: AppSettings = {};
  for (const r of data ?? []) {
    map[r.category] = {
      enabled: r.enabled !== false,
      header: r.header ?? "",
      lead: r.lead ?? "",
      taskLine: r.task_line ?? "",
      tail: r.tail ?? "",
    };
  }
  return map;
}

// info ボックス本文を組み立てる（前文 → 本体行 → 末尾）。
const buildInfoBox = (
  headerStr: string,
  leadStr: string,
  bodyLines: string[],
  tailStr: string
): string => {
  const lines: string[] = [];
  if (leadStr && leadStr.length) lines.push(leadStr);
  lines.push(...bodyLines);
  if (tailStr && tailStr.length) lines.push(tailStr);
  return `[info][title]${headerStr}[/title]\n${lines.join("\n")}\n[/info]`;
};

// カテゴリ指定で各通知メッセージを組み立てる
export async function buildNotifications(
  supabase: DB,
  categories: string[],
  options: BuildOptions = {}
): Promise<NotificationMsg[]> {
  const { includeEmpty = false } = options;
  const appSettings = options.appSettings ?? (await fetchAppSettings(supabase));
  const cats = categories.filter((c) => CAT_BY_KEY[c]);
  const today = jstDateStr(0);
  const dayIdx = jstWeekdayIndex();
  const weekEnd = jstDateStr((7 - dayIdx) % 7);
  const weekdayLabel = WEEKDAY[dayIdx] ?? "";

  const [{ data: projects, error: e1 }, { data: anken, error: e2 }, { data: tasks, error: e3 }, { data: members, error: e4 }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("is_deleted", false),
      supabase.from("anken").select("id, leader_id").eq("is_deleted", false),
      supabase.from("tasks").select("id, name, project_id, anken_id, end_date, status, assignee_ids, importance"),
      supabase.from("members").select("id, name, chat_id"),
    ]);
  const err = e1 || e2 || e3 || e4;
  if (err) throw err;

  const ankenRows = (anken ?? []) as { id: number; leader_id: number | null }[];
  const memberRows = (members ?? []) as { id: number; name: string; chat_id: string | null }[];
  const taskRows = (tasks ?? []) as NotifyTask[];

  const activeAnken = new Set(ankenRows.map((a) => a.id));
  const ankenLeader: Record<number, number | null> =
    Object.fromEntries(ankenRows.map((a) => [a.id, a.leader_id]));
  const memberById: Record<number, { id: number; name: string; chat_id: string | null }> =
    Object.fromEntries(memberRows.map((m) => [m.id, m]));
  const nameOf = (id: number): string => memberById[id]?.name ?? "";
  const namesOf = (ids: number[]): string =>
    (ids ?? []).map(nameOf).filter(Boolean).join("、");

  const mentionLine = (memberIds: number[]): string => {
    const seen = new Set<string>();
    const tags: string[] = [];
    memberIds.forEach((id) => {
      const cid = memberById[id]?.chat_id;
      if (cid && !seen.has(cid)) { seen.add(cid); tags.push(`[To:${cid}]`); }
    });
    return tags.length ? tags.join("") + "\n" : "";
  };

  const out: NotificationMsg[] = [];
  for (const p of projects ?? []) {
    const roomId = parseRoomId(p.notify_chat);
    if (!roomId || p.close_date) continue;
    const overrides = (p.notify_overrides ?? {}) as Record<string, Record<string, unknown>>;
    const pRec = p as unknown as Record<string, string | null>;

    const pt = taskRows.filter(
      (t) => t.project_id === p.id && activeAnken.has(t.anken_id) && t.status !== "completed"
    );
    const pool: Record<"overdue" | "weekDue" | "todayDue", NotifyTask[]> = {
      overdue:  pt.filter((t) => t.end_date && t.end_date < today),
      weekDue:  pt.filter((t) => t.end_date && t.end_date > today && t.end_date <= weekEnd),
      todayDue: pt.filter((t) => t.end_date === today),
    };
    const cpList: { n: number; date: string; name: string }[] = [];
    [1, 2, 3].forEach((n) => {
      const d = pRec[`checkpoint${n}_date`];
      if (d) cpList.push({ n, date: d, name: pRec[`checkpoint${n}_name`] || "" });
    });

    for (const key of cats) {
      const cat = CAT_BY_KEY[key];
      if (!cat) continue;
      const ov: TextOverride = overrides[key];
      const app: TextOverride = appSettings[key] as unknown as TextOverride;

      if (!resolveEnabled(ov, app)) continue;

      const tpl = {
        header:   resolveTextField("header",   cat.defaults.header,   ov, app),
        lead:     resolveTextField("lead",     cat.defaults.lead,     ov, app),
        taskLine: resolveTextField("taskLine", cat.defaults.taskLine, ov, app),
        tail:     resolveTextField("tail",     cat.defaults.tail,     ov, app),
      };

      // ── チェックポイント（PJ単位・ALL） ──
      if (cat.unit === "projectCp") {
        const gvars = { "プロジェクト名": p.name, "担当者": "", "日付": today, "曜日": weekdayLabel };
        const list = key === "weekCp"
          ? cpList.filter((c) => c.date > today && c.date <= weekEnd)
          : cpList.filter((c) => c.date === today);
        const nums = ["①", "②", "③"];
        if (!list.length) {
          if (includeEmpty) out.push({
            projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: null,
            message: "[toall]\n" + buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), ["（現在、該当するチェックポイントはありません）"], tpl.tail && renderTemplate(tpl.tail, gvars)),
          });
          continue;
        }
        const lines = list.map((c) =>
          renderTemplate(tpl.taskLine, { "番号": nums[c.n - 1] ?? "", "名称": c.name, "日付": c.date })
        );
        out.push({
          projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: null,
          message: "[toall]\n" + buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), lines, tpl.tail && renderTemplate(tpl.tail, gvars)),
        });
        continue;
      }

      const list = pool[cat.dl as "overdue" | "weekDue" | "todayDue"].filter((t) => impMatch(t, cat.imp));
      const taskVars = (t: NotifyTask) => ({
        "タスク名": t.name,
        "日付": t.end_date ?? "",
        "担当者": namesOf(t.assignee_ids),
        "重要度": importanceLabel(t.importance),
      });

      if (cat.unit === "project") {
        const gvars = { "プロジェクト名": p.name, "担当者": "", "日付": today, "曜日": weekdayLabel };
        if (!list.length) {
          if (includeEmpty) out.push({
            projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: null,
            message: "[toall]\n" + buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), ["（現在、該当するタスクはありません）"], tpl.tail && renderTemplate(tpl.tail, gvars)),
          });
          continue;
        }
        out.push({
          projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: null,
          message: "[toall]\n" + buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), list.map((t) => renderTemplate(tpl.taskLine, taskVars(t))), tpl.tail && renderTemplate(tpl.tail, gvars)),
        });
      } else {
        if (!list.length) {
          if (includeEmpty) {
            const gvars = { "プロジェクト名": p.name, "担当者": "（担当者）", "日付": today, "曜日": weekdayLabel };
            out.push({
              projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: null,
              message: buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), ["（現在、該当するタスクはありません）"], tpl.tail && renderTemplate(tpl.tail, gvars)),
            });
          }
          continue;
        }
        const byAssignee = new Map<number, NotifyTask[]>();
        list.forEach((t) => (t.assignee_ids ?? []).forEach((aid) => {
          if (!byAssignee.has(aid)) byAssignee.set(aid, []);
          byAssignee.get(aid)!.push(t);
        }));
        for (const [aid, aTasks] of byAssignee) {
          let mentions: number[] = [aid];
          if (cat.mention === "leaderAssignee") {
            const leaders = [...new Set(aTasks.map((t) => ankenLeader[t.anken_id]).filter((x): x is number => x != null))];
            mentions = [...leaders, aid];
          }
          const gvars = { "プロジェクト名": p.name, "担当者": nameOf(aid), "日付": today, "曜日": weekdayLabel };
          out.push({
            projectId: p.id, projectName: p.name, roomId, category: key, assigneeName: nameOf(aid),
            message: mentionLine(mentions) + buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), aTasks.map((t) => renderTemplate(tpl.taskLine, taskVars(t))), tpl.tail && renderTemplate(tpl.tail, gvars)),
          });
        }
      }
    }
  }

  return out;
}

// 対象が0件でも「どんな文面が送られるか」を示すサンプル群を返す（カテゴリ毎）
export function buildSampleMessage(categories: string[], appSettings: AppSettings = {}): string {
  const today = jstDateStr(0);
  const weekday = jstWeekdayLabel();
  const blocks: string[] = [];
  for (const key of categories) {
    const cat = CAT_BY_KEY[key];
    if (!cat) continue;
    const app = appSettings[key] as unknown as TextOverride;
    const tpl = {
      header:   resolveTextField("header",   cat.defaults.header,   null, app),
      lead:     resolveTextField("lead",     cat.defaults.lead,     null, app),
      taskLine: resolveTextField("taskLine", cat.defaults.taskLine, null, app),
      tail:     resolveTextField("tail",     cat.defaults.tail,     null, app),
    };
    const mentionEx =
      cat.mention === "all" ? "[toall]\n" :
      cat.mention === "leaderAssignee" ? "[To:リーダーID][To:担当者ID]\n" :
      "[To:担当者ID]\n";
    const gvars = { "プロジェクト名": "（プロジェクト名）", "担当者": "山田", "日付": today, "曜日": weekday };
    let bodyLines: string[];
    if (cat.unit === "projectCp") {
      bodyLines = [renderTemplate(tpl.taskLine, { "番号": "①", "名称": "（例）チェックポイント名", "日付": today })];
    } else {
      bodyLines = [
        renderTemplate(tpl.taskLine, { "タスク名": "（例）タスク名", "日付": today, "担当者": "山田、佐藤", "重要度": cat.imp === "3" ? "Ⅲ" : cat.imp === "12" ? "Ⅱ" : "" }),
      ];
    }
    const unitNote = cat.unit === "assignee" ? "担当者毎1通知" : cat.unit === "projectCp" ? "PJ毎1通知" : "対象全タスク1通知";
    const mentNote = cat.mention === "all" ? "ALL" : cat.mention === "leaderAssignee" ? "リーダー＋担当者" : "担当者";
    blocks.push(
      `《${cat.no} ${unitNote}／メンション:${mentNote}》\n` +
      mentionEx +
      buildInfoBox(renderTemplate(tpl.header, gvars), tpl.lead && renderTemplate(tpl.lead, gvars), bodyLines, tpl.tail && renderTemplate(tpl.tail, gvars))
    );
  }
  return blocks.join("\n\n");
}
