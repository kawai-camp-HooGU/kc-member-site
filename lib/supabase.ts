import { createBrowserClient } from "@supabase/ssr";
import type { Database, Tables, TablesInsert, Json } from "./database.types";
import type {
  Project, Anken, Task, Member, Template, Importance, MemberById, AppData,
} from "./models";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を .env.local に設定してください"
  );
}

// ============================================================
// ブラウザ用 Supabase クライアント（Phase 1 で Cookie セッションへ移行）
//
//   以前は createClient() を使っており、セッションが localStorage に
//   保存されていた。localStorage はサーバーから読めないため、
//   middleware や Server Component でログイン状態を判定できず、
//   ルート保護をサーバー側で行えなかった。
//
//   createBrowserClient() はセッションを Cookie に保存するため、
//   middleware（Phase 2 のゾーン分離）から参照できるようになる。
//
//   ⚠️ 移行時、既存ログインユーザーは一度サインアウトされる
//      （localStorage → Cookie への引っ越しのため）。リリース告知が必要。
// ============================================================
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnon);

// ── ヘルパー関数 ──────────────────────────────────────────────

/** DB行 → アプリ内オブジェクト変換（snake_case → camelCase） */
export const toProject = (r: Tables<"projects">): Project => ({
  id:               r.id,
  name:             r.name,
  abbreviation:     r.abbreviation ?? "",
  startDate:        r.start_date ?? "",
  dueDate:          r.due_date   ?? "",
  closeDate:        r.close_date ?? "",
  notifyChat:       r.notify_chat ?? "",
  checkpoint1Name:  r.checkpoint1_name ?? "",
  checkpoint1Date:  r.checkpoint1_date ?? "",
  checkpoint2Name:  r.checkpoint2_name ?? "",
  checkpoint2Date:  r.checkpoint2_date ?? "",
  checkpoint3Name:  r.checkpoint3_name ?? "",
  checkpoint3Date:  r.checkpoint3_date ?? "",
  progress:         r.progress   ?? 0,
  risk:             r.risk       ?? "normal",
  lastUpdated:      r.last_updated ?? "",
  tasksDueThisWeek: r.tasks_due_this_week ?? 0,
  tasksDelayed:     r.tasks_delayed       ?? 0,
  tasksCompleted:   r.tasks_completed     ?? 0,
  memberNames:      r.member_names        ?? [],
  notifyOverrides:  (r.notify_overrides as Record<string, unknown>) ?? {},
  isDeleted:        r.is_deleted ?? false,
});

// memberById を渡すと leader_id から表示名を解決する。
// 未指定時は後方互換として旧 text カラム r.leader を表示名に使う（Phase1の二重持ち期間用）。
export const toAnken = (r: Tables<"anken">, memberById: MemberById | null = null): Anken => {
  const leaderId = r.leader_id ?? null;
  let leader: string;
  if (memberById && leaderId != null) {
    leader = memberById[leaderId]?.name ?? (r.leader ?? "");
  } else {
    leader = r.leader ?? "";
  }
  return {
    id:               r.id,
    projectId:        r.project_id,
    name:             r.name,
    abbreviation:     r.abbreviation ?? "",
    leaderId,
    leader,
    progress:         r.progress    ?? 0,
    risk:             r.risk        ?? "normal",
    dueDate:          r.due_date    ?? "",
    lastUpdated:      r.last_updated ?? "",
    tasksDueThisWeek: r.tasks_due_this_week ?? 0,
    tasksDelayed:     r.tasks_delayed       ?? 0,
    tasksCompleted:   r.tasks_completed     ?? 0,
    isDeleted:        r.is_deleted ?? false,
  };
};

// memberById を渡すと assignee_ids から表示名を解決する（マスタの改名がタスク表示に追従）。
// 未指定時は後方互換として旧 text カラム r.assignees を表示名に使う。
export const toTask = (r: Tables<"tasks">, memberById: MemberById | null = null): Task => {
  const assigneeIds = r.assignee_ids ?? [];
  let assignees: string[];
  if (memberById && assigneeIds.length > 0) {
    assignees = assigneeIds
      .map((id) => memberById[id]?.name)
      .filter((n): n is string => Boolean(n));
    // IDが解決できない（マスタ未一致・backfill未実施など）場合は旧textへフォールバック
    if (assignees.length === 0) assignees = r.assignees ?? [];
  } else {
    assignees = r.assignees ?? [];
  }
  return {
    id:           r.id,
    projectId:    r.project_id,
    ankenId:      r.anken_id,
    name:         r.name,
    assigneeIds,
    assignees,
    start:        r.start_date   ?? "",
    end:          r.end_date     ?? "",
    status:       r.status       ?? "pending",
    risk:         r.risk         ?? "normal",
    progressMemo: r.progress_memo ?? "",
    specialNotes: r.special_notes ?? "",
    materials:    r.materials    ?? "",
    completedAt:  r.completed_at ?? null,
    importance:   (r.importance != null ? (r.importance as 1 | 2 | 3) : "none"),
    updatedAt:    r.updated_at   ?? null,
    updatedBy:    r.updated_by   ?? "",
  };
};

/**
 * members テーブルの行、または members_visible ビューの行。
 * Phase 1（RLS）以降、参照はビュー経由になるため両方を受け付ける。
 * ビュー側では本人・運営以外に対して機微カラムが null にマスクされている。
 */
export type MemberRow =
  | Tables<"members">
  | Database["public"]["Views"]["members_visible"]["Row"];

export const toMember = (r: MemberRow): Member => ({
  id:        r.id,
  name:      r.name,
  role:      r.role    ?? "メンバー",
  userId:    r.user_id ?? null,
  email:     r.email   ?? "",
  company:   r.company ?? "",
  chatId:    r.chat_id ?? "",
  isDeleted: r.is_deleted ?? false,
  kana:       r.kana ?? "",
  tel:        r.tel ?? "",
  prefecture: r.prefecture ?? "",
  createdAt:  r.created_at ?? "",
  // 流入経路（Phase 3）。source(text) は旧・互換用で、判定・表示には sourceId を使う。
  source:       r.source ?? "",
  sourceId:     r.source_id ?? null,
  lastSourceId: r.last_source_id ?? null,
  sourceAt:     r.source_at ?? "",
  attrIds:    [],
  memos:      [],
  pushDevices: 0,
  pushDeviceInfo: [],
  notifyEnabled: true,
  notifyChatEnabled: true,
  notifyNewsEnabled: true,
  firstLoginAt: r.first_login_at ?? "",
  lastLoginAt:  r.last_login_at ?? "",
  loginCount:   r.login_count ?? 0,
});

// 名前 → member.id 解決マップ（同名時は有効メンバーを優先）
const buildNameToId = (members: Member[] = []): Record<string, number> => {
  const map: Record<string, number> = {};
  [...members]
    .sort((a, b) => (a.isDeleted === b.isDeleted ? 0 : a.isDeleted ? -1 : 1))
    .forEach((m) => { if (m && m.name != null) map[m.name] = m.id; });
  return map;
};

export const toTemplate = (r: Tables<"templates">): Template => ({
  id:    r.id,
  name:  r.name,
  anken: [], // 後でtemplate_anken + template_tasksを結合
});

// ── アプリ → DB 変換（camelCase → snake_case） ────────────────

export const fromProject = (p: Project): TablesInsert<"projects"> => ({
  name:                p.name,
  abbreviation:        p.abbreviation || null,
  start_date:          p.startDate   || null,
  due_date:            p.dueDate     || null,
  close_date:          p.closeDate   || null,
  notify_chat:         p.notifyChat  || null,
  checkpoint1_name:    p.checkpoint1Name || null,
  checkpoint1_date:    p.checkpoint1Date || null,
  checkpoint2_name:    p.checkpoint2Name || null,
  checkpoint2_date:    p.checkpoint2Date || null,
  checkpoint3_name:    p.checkpoint3Name || null,
  checkpoint3_date:    p.checkpoint3Date || null,
  progress:            p.progress    ?? 0,
  risk:                p.risk        ?? "normal",
  last_updated:        new Date().toISOString().slice(0, 10),
  tasks_due_this_week: p.tasksDueThisWeek ?? 0,
  tasks_delayed:       p.tasksDelayed     ?? 0,
  tasks_completed:     p.tasksCompleted   ?? 0,
  member_names:        p.memberNames      ?? [],
  notify_overrides:    (p.notifyOverrides ?? {}) as TablesInsert<"projects">["notify_overrides"],
});

// members を渡すと leader(名前) から leader_id を解決して書き込む。
// Phase1 の間は旧 text カラム leader も二重書き込みする。
export const fromAnken = (a: Anken, members: Member[] | null = null): TablesInsert<"anken"> => {
  const row: TablesInsert<"anken"> = {
    project_id:          a.projectId,
    name:                a.name,
    abbreviation:        a.abbreviation || null,
    leader:              a.leader   ?? "",
    progress:            a.progress ?? 0,
    risk:                a.risk     ?? "normal",
    due_date:            a.dueDate  || null,
    last_updated:        new Date().toISOString().slice(0, 10),
    tasks_due_this_week: a.tasksDueThisWeek ?? 0,
    tasks_delayed:       a.tasksDelayed     ?? 0,
    tasks_completed:     a.tasksCompleted   ?? 0,
  };
  if (members) {
    const nameToId = buildNameToId(members);
    row.leader_id = (a.leader && nameToId[a.leader] != null) ? nameToId[a.leader] : null;
  } else if (a.leaderId != null) {
    row.leader_id = a.leaderId;
  }
  return row;
};

// members を渡すと assignees(名前) から assignee_ids を解決して書き込む。
// Phase1 の間は旧 text カラム assignees も二重書き込みする。
export const fromTask = (t: Task, members: Member[] | null = null): TablesInsert<"tasks"> => {
  const row: TablesInsert<"tasks"> = {
    project_id:    t.projectId,
    anken_id:      t.ankenId,
    name:          t.name,
    assignees:     t.assignees    ?? [],
    start_date:    t.start        || null,
    end_date:      t.end          || null,
    status:        t.status       ?? "pending",
    risk:          t.risk         ?? "normal",
    progress_memo: t.progressMemo ?? "",
    special_notes: t.specialNotes ?? "",
    materials:     t.materials    ?? "",
    completed_at:  t.completedAt  ?? null,
    importance:    (t.importance && t.importance !== "none") ? t.importance : null,
  };
  if (members) {
    const nameToId = buildNameToId(members);
    row.assignee_ids = (t.assignees ?? [])
      .map((n) => nameToId[n])
      .filter((id): id is number => id != null);
  } else if (Array.isArray(t.assigneeIds)) {
    row.assignee_ids = t.assigneeIds;
  }
  // 最終更新者（指定された保存のみ列を更新。未指定の保存では既存値を維持）
  if (t.updatedBy) row.updated_by = t.updatedBy;
  return row;
};

export const fromMember = (m: Member): TablesInsert<"members"> => ({
  name:    m.name,
  role:    m.role    ?? "メンバー",
  user_id: m.userId  ?? null,
  email:   m.email   ?? null,
  company: m.company || null,
  chat_id: m.chatId  || null,
  kana:       m.kana ?? null,
  tel:        m.tel ?? null,
  prefecture: m.prefecture ?? null,
});

// ── 全データ取得 ───────────────────────────────────────────────

export async function fetchAllData(): Promise<AppData> {
  const [
    { data: projects, error: e1 },
    { data: anken,    error: e2 },
    { data: tasks,    error: e3 },
    { data: members,  error: e4 },
    { data: templates, error: e5 },
    { data: tmplAnken, error: e6 },
    { data: tmplTasks, error: e7 },
    { data: memberAttrs, error: e8 },
    { data: memberMemos, error: e9 },
    { data: pushSubs, error: e10 },
    { data: notifySettings, error: e11 },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("is_deleted", false).order("id"),
    supabase.from("anken").select("*").eq("is_deleted", false).order("id"),
    supabase.from("tasks").select("*").order("id"),
    // members は名前解決のため削除済みも含め全件取得（選択UIでは有効のみ提示）
    //
    // ⚠️ Phase 1（RLS）以降、members 本体は「本人の行」しか返らない。
    //    担当者名・リーダー名の表示が壊れないよう、参照は members_visible
    //    ビューから行う（氏名・ロールは全員に公開、メール等の機微情報は
    //    本人と運営にしか返らないようビュー側でマスクされている）。
    //    書き込みは従来どおり members テーブルに対して行う（RLS が効く）。
    supabase.from("members_visible").select("*").order("name"),
    supabase.from("templates").select("*").eq("is_deleted", false).order("id"),
    supabase.from("template_anken").select("*").order("sort_order"),
    supabase.from("template_tasks").select("*").order("sort_order"),
    supabase.from("member_attributes").select("*"),
    supabase.from("member_memos").select("*").order("sort_order"),
    supabase.from("push_subscriptions").select("member_id, user_agent, created_at"),
    supabase.from("notification_settings").select("*"),
  ]);

  const err = e1 || e2 || e3 || e4 || e5 || e6 || e7;
  if (err) throw err;
  // 属性・メモは未マイグレーション時でもアプリ全体を止めないよう非致命扱い
  if (e8) console.warn("member_attributes 取得エラー（マイグレーション未適用の可能性）:", e8);
  if (e9) console.warn("member_memos 取得エラー（マイグレーション未適用の可能性）:", e9);
  if (e10) console.warn("push_subscriptions 取得エラー（マイグレーション未適用の可能性）:", e10);
  if (e11) console.warn("notification_settings 取得エラー（マイグレーション未適用の可能性）:", e11);

  // member.id → member マップ（削除済みも含む。改名・削除済みの表示名解決に使用）
  const memberObjs: Member[] = (members ?? []).map(toMember);
  // 属性・メモをメンバーに結合
  const attrsByMember = new Map<number, number[]>();
  (memberAttrs ?? []).forEach((r) => {
    const arr = attrsByMember.get(r.member_id) ?? [];
    arr.push(r.attribute_id);
    attrsByMember.set(r.member_id, arr);
  });
  const memosByMember = new Map<number, { id?: number; title: string; body: string; updatedAt: string }[]>();
  (memberMemos ?? []).forEach((r) => {
    const arr = memosByMember.get(r.member_id) ?? [];
    arr.push({ id: r.id, title: r.title ?? "", body: r.body ?? "", updatedAt: r.updated_at ?? "" });
    memosByMember.set(r.member_id, arr);
  });
  // 通知（Web Push）: 登録端末とON/OFF設定をメンバーに結合
  const devicesByMember = new Map<number, { userAgent: string; createdAt: string }[]>();
  (pushSubs ?? []).forEach((r) => {
    const arr = devicesByMember.get(r.member_id) ?? [];
    arr.push({ userAgent: r.user_agent ?? "", createdAt: r.created_at ?? "" });
    devicesByMember.set(r.member_id, arr);
  });
  const notifyByMember = new Map<number, { enabled: boolean; chat: boolean; news: boolean }>();
  (notifySettings ?? []).forEach((r) => {
    notifyByMember.set(r.member_id, {
      enabled: r.enabled ?? true,
      chat:    r.chat_enabled ?? true,
      news:    r.news_enabled ?? true,
    });
  });
  memberObjs.forEach((m) => {
    m.attrIds = attrsByMember.get(m.id) ?? [];
    m.memos   = memosByMember.get(m.id) ?? [];
    const devs = devicesByMember.get(m.id) ?? [];
    // 設定行が無い場合は既定ON
    const ns = notifyByMember.get(m.id) ?? { enabled: true, chat: true, news: true };
    m.pushDevices       = devs.length;
    m.pushDeviceInfo    = devs;
    m.notifyEnabled     = ns.enabled;
    m.notifyChatEnabled = ns.chat;
    m.notifyNewsEnabled = ns.news;
  });
  const memberById: MemberById = Object.fromEntries(memberObjs.map((m) => [m.id, m]));

  // テンプレートを入れ子構造に組み立て
  const templatesNested: Template[] = (templates ?? []).map((t) => ({
    ...toTemplate(t),
    anken: (tmplAnken ?? [])
      .filter((a) => a.template_id === t.id)
      .map((a) => ({
        name:  a.name,
        tasks: (tmplTasks ?? [])
          .filter((tk) => tk.template_anken_id === a.id)
          .map((tk) => ({
            name:         tk.name,
            startOffset:  (tk.start_offset == null ? "" : tk.start_offset) as number | "",
            endOffset:    (tk.end_offset   == null ? "" : tk.end_offset) as number | "",
            importance:   (tk.importance != null ? (tk.importance as 1 | 2 | 3) : "none") as Importance,
            progressMemo: tk.progress_memo ?? "",
            specialNotes: tk.special_notes ?? "",
            materials:    tk.materials     ?? "",
          })),
      })),
  }));

  // tasks は is_deleted を持たず全件返るため、有効な親(project/anken)に属すものだけ残す
  const activeProjectIds = new Set((projects ?? []).map((p) => p.id));
  const activeAnkenIds   = new Set((anken    ?? []).map((a) => a.id));
  const visibleTasks = (tasks ?? []).filter(
    (t) => activeProjectIds.has(t.project_id) && activeAnkenIds.has(t.anken_id)
  );

  return {
    projects:  (projects  ?? []).map(toProject),
    anken:     (anken     ?? []).map((r) => toAnken(r, memberById)),
    tasks:     visibleTasks.map((r) => toTask(r, memberById)),
    members:   memberObjs,
    templates: templatesNested,
  };
}

// ── テンプレート保存（入れ子構造をフラットなDB行に変換） ──────

export async function saveTemplateToDb(tmpl: Template): Promise<number> {
  let templateId = tmpl.id;
  if (templateId) {
    // 更新: 既存の分類・タスクを全削除して再挿入（シンプルな方式）
    await supabase.from("template_anken").delete().eq("template_id", templateId);
    await supabase.from("templates").update({ name: tmpl.name }).eq("id", templateId);
  } else {
    // 新規
    const { data, error } = await supabase
      .from("templates")
      .insert({ name: tmpl.name })
      .select("id")
      .single();
    if (error) throw error;
    templateId = data.id;
  }

  // 分類＋タスクを挿入
  for (let ai = 0; ai < tmpl.anken.length; ai++) {
    const a = tmpl.anken[ai];
    const { data: ankenRow, error: ae } = await supabase
      .from("template_anken")
      .insert({ template_id: templateId, name: a.name, sort_order: ai })
      .select("id")
      .single();
    if (ae) throw ae;

    if (a.tasks.length > 0) {
      const numOrNull = (v: number | "" | null): number | null =>
        (v === "" || v == null) ? null : Number(v);
      const { error: te } = await supabase.from("template_tasks").insert(
        a.tasks.map((tk, ti) => ({
          template_anken_id: ankenRow.id,
          name:          tk.name,
          start_offset:  numOrNull(tk.startOffset),
          end_offset:    numOrNull(tk.endOffset),
          importance:    (tk.importance && tk.importance !== "none") ? Number(tk.importance) : null,
          progress_memo: tk.progressMemo || null,
          special_notes: tk.specialNotes || null,
          materials:     tk.materials    || null,
          sort_order:    ti,
        }))
      );
      if (te) throw te;
    }
  }

  return templateId;
}

// ── 全般設定（app_settings：機能ON/OFF）──────────────────────
import type { AppSettings, WelcomeRoute } from "./models";
import { DEFAULT_APP_SETTINGS } from "./models";

export async function loadAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return DEFAULT_APP_SETTINGS;
  const routes = Array.isArray(data.welcome_routes) ? (data.welcome_routes as unknown as WelcomeRoute[]) : [];
  return {
    chatworkEnabled: data.chatwork_enabled,
    bulkRegisterEnabled: data.bulk_register_enabled,
    contentEnabled: data.content_enabled,
    welcomeEnabled: data.welcome_enabled ?? false,
    welcomeDefault: data.welcome_default ?? "",
    welcomeRoutes: routes
      .filter((r) => r && typeof r.key === "string")
      .map((r) => ({ key: r.key, label: r.label ?? r.key, message: r.message ?? "" })),
  };
}

export async function saveAppSettings(s: AppSettings): Promise<void> {
  await supabase.from("app_settings").upsert({
    id: 1,
    chatwork_enabled: s.chatworkEnabled,
    bulk_register_enabled: s.bulkRegisterEnabled,
    content_enabled: s.contentEnabled,
    welcome_enabled: s.welcomeEnabled,
    welcome_default: s.welcomeDefault || null,
    welcome_routes: s.welcomeRoutes as unknown as Json,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
}
