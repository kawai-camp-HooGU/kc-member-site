"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import {
  supabase, fetchAllData, fromTask,
  toProject, toAnken, toTask, toMember,
} from "./lib/supabase";
import type { Tables } from "./lib/database.types";
import type { Project, Anken, Task, Member, Template, MemberById, ContentSection } from "./lib/models";
import type { PermMap, Feature } from "./lib/permissions";
import { fetchContentSections, canView as canViewContent } from "./lib/contents";
import { loadAttributeTree } from "./lib/attributes";
import type { AttrNode } from "./lib/attributes";
import { buildAttrIndex } from "./lib/members";
import { DEFAULT_PERMS, canFor, loadRolePermissions } from "./lib/permissions";
import { loadRoles } from "./lib/roles";
import { touchLogin } from "./lib/engagement";
import { DEFAULT_FILTERS } from "./lib/filters";
import type { Filters } from "./lib/filters";
import { usePermission } from "./hooks/usePermission";
import { useChatUnread } from "./hooks/useChatUnread";
import { useLineUnread } from "./hooks/useLineUnread";
import { MasterContext } from "./hooks/useMaster";
import { INITIAL_PROJECTS, INITIAL_ANKEN, INITIAL_TASKS, INITIAL_MEMBERS, INITIAL_TEMPLATES } from "./lib/seed";
import { SidebarContent } from "./components/layout/SidebarContent";
import { ToastProvider } from "./components/common/ToastProvider";
import { ConfirmProvider } from "./components/common/ConfirmProvider";
import { PaymentView } from "./components/payment/PaymentView";
import { RefundView } from "./components/refund/RefundView";
import { RefundMasterView } from "./components/master/RefundMasterView";
import { LogoMark } from "./components/layout/LogoMark";
import { ViewTabs } from "./components/layout/ViewTabs";
import { HelpView } from "./components/layout/HelpView";
import { HomeView } from "./components/layout/HomeView";
import { TutorialView } from "./components/layout/TutorialView";
import { BookmarksView } from "./views/BookmarksView";
import { BotChatView } from "./views/BotChatView";
import { BotSettingsView } from "./views/BotSettingsView";
import { NotificationView } from "./views/NotificationView";
import { ContentView } from "./components/content/ContentView";
import { ContentSettingsView } from "./components/content/ContentSettingsView";
import { NewTaskModal } from "./components/task/NewTaskModal";
import { DashboardView } from "./views/DashboardView";
import { KanbanView } from "./views/KanbanView";
import { GanttView } from "./views/GanttView";
import { CalendarView } from "./views/CalendarView";
import { BulkRegisterView } from "./views/BulkRegisterView";
import { MasterView } from "./views/MasterView";
import { ChatView } from "./views/ChatView";
import { MemberChatView } from "./views/MemberChatView";
import { LineChatView } from "./views/LineChatView";
import { LineFriendsView } from "./views/LineFriendsView";
import { LineAccountsView } from "./views/LineAccountsView";
import { LineLinkQueueView } from "./views/LineLinkQueueView";
import { LineRichMenuView } from "./views/LineRichMenuView";
import { LineAutoReplyView } from "./views/LineAutoReplyView";
import { LineAnalyticsView } from "./views/LineAnalyticsView";
import { LineTemplatesView } from "./views/LineTemplatesView";
import { SourceTab } from "./components/master/SourceTab";
import { CustomersView } from "./views/CustomersView";
import { ListsView } from "./views/ListsView";
import { BroadcastView } from "./views/BroadcastView";
import { ScenarioView } from "./views/ScenarioView";
import { SuppressionView } from "./views/SuppressionView";
import { FormView } from "./views/FormView";
import { MailView, MailboxView, MailThreadsView } from "./views/MailView";
import { OpsDashboardView } from "./views/OpsDashboardView";
import { StaffActivityLogView } from "./views/StaffActivityLogView";
import type { Zone } from "./lib/zone";
import { isOpsView, isOpsRole, loginPathFor } from "./lib/zone";
import { useRoute } from "./hooks/useRoute";
import { buildPath } from "./lib/routes";
import { onChildUpdate } from "./lib/childWindow";

/**
 * 廃止したビュー（REQ-027）。ブックマークやリンクで来た人を空白画面にしないため、
 * ゾーンのトップへ逃がす。実体を消したら必ずここに登録すること。
 *   summary … 顧客＞サマリー。集計は運営ダッシュボード（opsdash）へ吸収した。
 */
const RETIRED_VIEWS = new Set<string>(["summary"]);

export interface AppProps {
  /**
   * どの入り口から来たか（Phase 2：入り口分離）。
   *   "ops"    … /ops   運営コンソール。運営ビュー（設定・一斉配信・シナリオ等）を表示。
   *   "member" … /      会員ポータル。運営ビューは表示しない。
   * サーバー側のガードは middleware.ts。ここは「見た目の出し分け」なので、
   * これ単独をセキュリティ境界と考えないこと（本丸は RLS）。
   */
  zone?: Zone;
}

/**
 * Realtime の members 更新をマージする。
 *
 *   ⚠️ payload は members テーブルの「生の行」なので、toMember() が返す Member は
 *      attrIds / memos / 通知設定が空（別テーブルから結合している項目のため）。
 *      そのまま置き換えると、画面が持っている属性が消える。
 *
 *   これが実害を出していた例：
 *      ログインすると last_login_at・login_count が更新される
 *      → members の UPDATE が飛ぶ
 *      → 自分の attrIds が [] に戻る
 *      → 属性で公開範囲を絞ったコンテンツページ・お知らせが「見えない」
 *      （DB も RLS も正しいのに画面だけ消える、という厄介な症状になる）
 *
 *   → 結合済みの項目は既存オブジェクトから引き継ぐ。
 */
function mergeMember(prev: Member | undefined, next: Member): Member {
  if (!prev) return next;
  return {
    ...next,
    attrIds:           prev.attrIds ?? [],
    memos:             prev.memos ?? [],
    pushDevices:       prev.pushDevices ?? 0,
    pushDeviceInfo:    prev.pushDeviceInfo ?? [],
    notifyEnabled:     prev.notifyEnabled ?? true,
    notifyChatEnabled: prev.notifyChatEnabled ?? true,
    notifyNewsEnabled: prev.notifyNewsEnabled ?? true,
  };
}

export default function App({ zone = "member" }: AppProps) {
  const router = useRouter();
  const isOpsZone = zone === "ops";

  // ── 画面（view）と詳細IDは URL から導出する（固定URL化）──
  //    setView は使わない。router.push でURLを変え、その結果としてこの view が変わる。
  const route = useRoute();
  const view = route.view;
  const setView = (k: string) => route.go(k);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [ganttFromProject, setGanttFromProject] = useState(false);
  const goSidebar = (k: string) => { setFilters(DEFAULT_FILTERS); setGanttFromProject(false); route.go(k); };
  const goTab = (k: string) => { route.go(k); };
  const goProjectView = (k: string, pid: number) => { setFilters({ ...DEFAULT_FILTERS, project: [String(pid)] }); setGanttFromProject(k === "gantt"); route.go(k); };
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dupTask, setDupTask] = useState<Task | null>(null);

  const [tasks,     setTasks]     = useState<Task[]>(INITIAL_TASKS);
  const [projects,  setProjects]  = useState<Project[]>(INITIAL_PROJECTS);
  const [anken,     setAnken]     = useState<Anken[]>(INITIAL_ANKEN);
  const [members,   setMembers]   = useState<Member[]>(INITIAL_MEMBERS);

  const membersRef = useRef<Member[]>(members);
  useEffect(() => { membersRef.current = members; }, [members]);
  const memberByIdNow = (): MemberById => Object.fromEntries((membersRef.current ?? []).map((m) => [m.id, m]));

  const permission = usePermission(user, members, projects);
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [perms, setPerms] = useState<PermMap>(DEFAULT_PERMS);
  // コンテンツの入口（セクション）。生データを保持し、閲覧可・公開中のものを memo で算出。
  const [contentSectionsRaw, setContentSectionsRaw] = useState<ContentSection[]>([]);
  const [attrTree, setAttrTree] = useState<AttrNode[]>([]);

  // ロール権限マスタ判定：ログインユーザーのロールが機能を使えるか
  const can = useCallback(
    (feature: Feature): boolean => canFor(perms, permission.roleLabel, feature),
    [perms, permission.roleLabel]
  );

  // コンテンツの入口（セクション）：公開中かつ、この会員が閲覧できるものだけを並び順で。
  //   運営（admin/leader）は全公開セクションを見られる。属性判定はページと同じ canView。
  const seeAllContent = permission.role === "admin" || permission.role === "leader";
  const myAttrIds = useMemo(
    () => members.find((m) => m.id === permission.myId)?.attrIds ?? [],
    [members, permission.myId]
  );
  const attrIndex = useMemo(() => buildAttrIndex(attrTree), [attrTree]);
  const contentSections = useMemo<ContentSection[]>(
    () => contentSectionsRaw
      .filter((s) => s.published)
      .filter((s) => seeAllContent || canViewContent(s.attrIds, s.attrMode, myAttrIds, attrIndex))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [contentSectionsRaw, seeAllContent, myAttrIds, attrIndex]
  );

  // サイドバー「Chat」の未確認メッセージ総数（スタッフ=全顧客合計 / メンバー=事務局発）
  const isStaff = permission.role === "admin" || permission.role === "leader";
  const chatUnread = useChatUnread(can("chat"), isStaff, permission.myId);
  const lineUnread = useLineUnread(can("line_chat"));

  // 初回ログイン時のウェルカムメッセージ送信（メンバー/外部のみ・サーバー側で冪等に一度だけ）
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (!user || welcomedRef.current) return;
    if (permission.role !== "member" && permission.role !== "external") return;
    if (permission.myId == null) return; // メンバー行が読み込まれてから
    welcomedRef.current = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await fetch("/api/chat/welcome", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
      } catch { /* 送信失敗は次回ログインで再試行 */ }
    })();
  }, [user, permission.role, permission.myId]);

  // ログイン記録（最終ログイン日時・回数）。セッションごとに1回だけ。
  const loggedRef = useRef(false);
  useEffect(() => {
    if (!user || loggedRef.current) return;
    if (permission.myId == null) return;   // メンバー行が読み込まれてから
    loggedRef.current = true;
    touchLogin();
  }, [user, permission.myId]);

  // 権限マスタで不可のビューをURL直打ちされたらトップへ退避（履歴を汚さないよう replace）
  //   ※ あくまで見た目のガード。サーバー側の境界は middleware と RLS。
  useEffect(() => {
    const home = isOpsZone ? "/ops" : "/";
    // 廃止したビュー（REQ-027 で削除）。ブックマーク救済のためトップへ逃がす。
    //   ⚠️ OPS_VIEWS から外した時点で会員ゾーンのゾーンガードも効かなくなるため、
    //      ゾーンを問わずここで拾う。これが無いと本文が空白のまま残る。
    if (RETIRED_VIEWS.has(view)) { router.replace(home); return; }
    // ゾーン外のビュー（会員ゾーンで運営ビューを開こうとした）
    if (!isOpsZone && isOpsView(view)) { router.replace(home); return; }
    // 権限マスタで不可のビュー
    if (view === "home" && !can("home")) {
      router.replace(buildPath(zone, can("dashboard") ? "dashboard" : "kanban"));
    } else if (view === "dashboard" && !can("dashboard")) {
      router.replace(buildPath(zone, "kanban"));
    } else if (view === "opsdash" && !can("ops_dashboard")) {
      // 運営ダッシュボードは /ops の着地。権限が無くても白画面にしない。
      router.replace(buildPath(zone, can("home") ? "home" : can("dashboard") ? "dashboard" : "kanban"));
    }
  }, [can, view, isOpsZone, zone, router]);

  // 運営ゾーンに会員ロールが到達した場合は会員ゾーンへ戻す（middleware をすり抜けた場合の保険）
  useEffect(() => {
    if (!isOpsZone || !user) return;
    if (permission.myId == null) return;               // members 行の読み込み待ち
    if (!isOpsRole(permission.roleLabel)) router.push("/");
  }, [isOpsZone, user, permission.myId, permission.roleLabel, router]);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchAllData();
      setProjects(data.projects);
      setAnken(data.anken);
      setTasks(data.tasks);
      setMembers(data.members);
      setTemplates(data.templates);
    } catch (err) {
      console.error("データ読み込みエラー:", err);
    }
    // ⚠️ ロールマスタを先に読む。isStaffRole() / effectiveRole() は
    //    このキャッシュを参照する同期関数のため、権限の解決より前に必要。
    await loadRoles();
    setPerms(await loadRolePermissions());
    // コンテンツの入口（セクション）＋属性ツリー（セクション出し分け判定に使用）。
    //   マイグレーション未適用など失敗時は空にフォールバック（従来動作＝入口1つに縮退）。
    try { setContentSectionsRaw(await fetchContentSections()); } catch (e) { console.warn("セクション読込エラー:", e); setContentSectionsRaw([]); }
    try { setAttrTree(await loadAttributeTree()); } catch (e) { console.warn("属性ツリー読込エラー:", e); setAttrTree([]); }
  }, []);

  useEffect(() => {
    // 未ログイン時はゾーンに応じたログイン画面へ（/ops → /ops/login、/ → /login）
    //   ※ 通常は middleware が先に 302 するので、ここは保険＆サインアウト時の導線。
    const loginPath = loginPathFor(zone);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push(loginPath); setLoading(false); return; }
      setUser(session.user);
      loadData().finally(() => setLoading(false));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) router.push(loginPath);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 別ウィンドウ（メンバー詳細など）で保存・削除されたら一覧を読み直す。
  //   ⚠️ Realtime の members UPDATE だけでは足りない。属性・メモは members 行に
  //      無いため mergeMember が旧値を維持し、属性の変更が一覧に反映されない。
  useEffect(() => {
    if (!user) return;
    return onChildUpdate(() => { loadData(); });
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("realtime-pj")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "projects" }, (payload) => {
        const r = payload.new as Tables<"projects">;
        if (!r.is_deleted) setProjects((p) => p.some((x) => x.id === r.id) ? p : [...p, toProject(r)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects" }, (payload) => {
        const r = payload.new as Tables<"projects">;
        if (r.is_deleted) {
          setProjects((p) => p.filter((x) => x.id !== r.id));
          setAnken((p) => p.filter((a) => a.projectId !== r.id));
          setTasks((p) => p.filter((t) => t.projectId !== r.id));
        } else {
          setProjects((p) => p.some((x) => x.id === r.id) ? p.map((x) => x.id === r.id ? toProject(r) : x) : [...p, toProject(r)]);
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "projects" }, (payload) => {
        const r = payload.old as Tables<"projects">;
        setProjects((p) => p.filter((x) => x.id !== r.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "anken" }, (payload) => {
        const r = payload.new as Tables<"anken">;
        if (!r.is_deleted) setAnken((p) => p.some((x) => x.id === r.id) ? p : [...p, toAnken(r, memberByIdNow())]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "anken" }, (payload) => {
        const r = payload.new as Tables<"anken">;
        if (r.is_deleted) {
          setAnken((p) => p.filter((x) => x.id !== r.id));
          setTasks((p) => p.filter((t) => t.ankenId !== r.id));
        } else {
          setAnken((p) => p.some((x) => x.id === r.id) ? p.map((x) => x.id === r.id ? toAnken(r, memberByIdNow()) : x) : [...p, toAnken(r, memberByIdNow())]);
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "anken" }, (payload) => {
        const r = payload.old as Tables<"anken">;
        setAnken((p) => p.filter((x) => x.id !== r.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, (payload) => {
        const r = payload.new as Tables<"tasks">;
        setTasks((p) => p.some((x) => x.id === r.id) ? p : [...p, toTask(r, memberByIdNow())]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, (payload) => {
        const r = payload.new as Tables<"tasks">;
        setTasks((p) => p.map((x) => x.id === r.id ? toTask(r, memberByIdNow()) : x));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        const r = payload.old as Tables<"tasks">;
        setTasks((p) => p.filter((x) => x.id !== r.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "members" }, (payload) => {
        const r = payload.new as Tables<"members">;
        setMembers((p) => {
          const m = toMember(r);
          const i = p.findIndex((x) => x.id === m.id || (x.id == null && x.name === m.name));
          // 既に画面にある行なら、結合済みの属性・メモを引き継ぐ（mergeMember の説明を参照）
          return i >= 0 ? p.map((x, idx) => idx === i ? mergeMember(x, m) : x) : [...p, m];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "members" }, (payload) => {
        const r = payload.new as Tables<"members">;
        const m = toMember(r);
        const byId = memberByIdNow();
        byId[m.id] = m;
        // ⚠️ ここで m にそのまま置き換えると attrIds が消える（mergeMember の説明を参照）。
        //    ログイン時の last_login_at 更新でも UPDATE が飛ぶため、影響が大きい。
        setMembers((p) => p.some((x) => x.id === m.id)
          ? p.map((x) => x.id === m.id ? mergeMember(x, m) : x)
          : [...p, m]);
        setTasks((p) => p.map((t) => {
          if (!t.assigneeIds || !t.assigneeIds.includes(m.id)) return t;
          const names = t.assigneeIds.map((id) => byId[id]?.name).filter((n): n is string => Boolean(n));
          return names.length > 0 ? { ...t, assignees: names } : t;
        }));
        setAnken((p) => p.map((a) => a.leaderId === m.id ? { ...a, leader: m.name } : a));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "members" }, (payload) => {
        const r = payload.old as Tables<"members">;
        setMembers((p) => p.filter((x) => x.id !== r.id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "templates" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "template_anken" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "template_tasks" }, loadData)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, loadData]);

  const handleSave = async (updated: Task) => {
    const existing = tasks.find((t) => t.id === updated.id);
    let completedAt = updated.completedAt ?? null;
    if (updated.status === "completed" && existing?.status !== "completed") completedAt = new Date().toISOString();
    else if (updated.status !== "completed") completedAt = null;
    const toSave: Task = { ...updated, completedAt };

    const exists = tasks.some((t) => t.id === toSave.id);
    const memberById: MemberById = Object.fromEntries(members.map((m) => [m.id, m]));
    if (exists) {
      const { error } = await supabase.from("tasks").update(fromTask(toSave, members)).eq("id", toSave.id);
      if (!error) setTasks((prev) => prev.map((t) => t.id === toSave.id ? toSave : t));
    } else {
      const { data, error } = await supabase.from("tasks").insert(fromTask(toSave, members)).select().single();
      if (!error && data) setTasks((prev) => [...prev, toTask(data, memberById)]);
    }
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (!error) setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSignOut = async () => { await supabase.auth.signOut(); };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">読み込み中...</div>
    </div>
  );

  const userInitial = (user?.email?.[0] ?? "?").toUpperCase();
  const closedProjectIds = new Set(projects.filter((p) => p.closeDate).map((p) => p.id));
  const activeTasks = tasks.filter((t) => !closedProjectIds.has(t.projectId));

  // 運営ゾーンでのみ表示するビュー（会員ゾーンでは can() が通っても出さない）
  const canView = (feature: Feature, viewKey: string): boolean =>
    can(feature) && (isOpsZone || !isOpsView(viewKey));

  return (
    <ToastProvider>
    <ConfirmProvider>
    <MasterContext.Provider value={{ projects, setProjects, anken, setAnken, members, setMembers, templates, setTemplates, tasks, setTasks, permission, perms, setPerms, can, contentSections }}>
      <div className="min-h-screen bg-gray-50 font-sans flex">
        <aside className="hidden sm:flex sm:flex-col w-64 shrink-0 bg-neutral-900 sticky top-0 h-screen">
          <SidebarContent view={view} onSelect={goSidebar} permission={permission} zone={zone} subview={route.detail[0] ?? ""}
            user={user} userInitial={userInitial} onSignOut={handleSignOut} chatUnread={chatUnread} lineUnread={lineUnread} />
        </aside>

        {drawerOpen && (
          <div className="sm:hidden fixed inset-0 z-50 flex">
            <div className="w-64 max-w-[85%] bg-neutral-900 h-full shadow-2xl">
              <SidebarContent view={view} onSelect={goSidebar} permission={permission} zone={zone} subview={route.detail[0] ?? ""}
                user={user} userInitial={userInitial} onSignOut={handleSignOut} chatUnread={chatUnread} lineUnread={lineUnread}
                onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sm:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
            <button onClick={() => setDrawerOpen(true)} className="text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center -ml-1" aria-label="メニュー">☰</button>
            <div className="flex items-center gap-2">
              <LogoMark box="w-7 h-7" icon="w-4 h-4" />
              <span className="text-sm font-bold tracking-wide">
                <span className="text-gray-900">KAWAI</span><span className="text-red-600"> CAMP</span>
                {isOpsZone && <span className="text-red-600"> OPS</span>}
              </span>
            </div>
            <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm">{userInitial}</div>
          </header>

          <main className="max-w-6xl w-full mx-auto px-4 py-6">
            {["kanban", "gantt", "calendar"].includes(view) && <ViewTabs view={view} onChange={goTab} filters={filters} projects={projects} anken={anken} />}
            {view === "home"      && can("home") && <HomeView onOpen={goSidebar} chatUnread={chatUnread} />}
            {view === "news"      && can("home") && <HomeView onOpen={goSidebar} chatUnread={chatUnread} />}   {/* /news/{id}：お知らせ詳細 */}
            {view === "dashboard" && can("dashboard") && <DashboardView tasks={activeTasks} onOpenView={goProjectView} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "kanban"    && can("kanban")   && <KanbanView    tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "gantt"     && can("gantt")    && <GanttView     tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} hideProjectCol={ganttFromProject} onOpenBulk={canView("bulk_register", "bulkadd") ? () => setView("bulkadd") : undefined} />}
            {view === "calendar"  && can("calendar") && <CalendarView  tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "bulkadd"   && canView("bulk_register", "bulkadd") && <BulkRegisterView tasks={tasks} filters={filters} onSave={handleSave} onDone={(pid) => goProjectView("gantt", pid)} onCancel={() => setView("gantt")} />}
            {view === "content"    && can("content")        && <ContentView />}
            {view === "chat"       && can("chat") && (
              (permission.role === "admin" || permission.role === "leader") ? <ChatView /> : <MemberChatView />
            )}
            {view === "opsdash"    && canView("ops_dashboard", "opsdash") && (
              <OpsDashboardView
                chatUnread={chatUnread}
                lineUnread={lineUnread}
                onOpen={goSidebar}
                onOpenHref={(href) => router.push(href)}
                onPrefetch={(v) => { try { router.prefetch(buildPath(zone, v)); } catch { /* noop */ } }}
              />
            )}
            {view === "staff-logs" && canView("staff_activity", "staff-logs") && <StaffActivityLogView />}
            {view === "customers"     && canView("customers", "customers")        && <CustomersView />}
            {view === "lists"         && canView("contact_list", "lists")       && <ListsView />}
            {view === "line"          && canView("line_chat", "line")            && <LineChatView />}
            {view === "line-friends"  && canView("line_friends", "line-friends") && <LineFriendsView />}
            {view === "line-match"    && canView("line_match", "line-match")     && <LineLinkQueueView />}
            {view === "line-richmenu" && canView("line_richmenu", "line-richmenu") && <LineRichMenuView />}
            {view === "line-autoreply" && canView("line_autoreply", "line-autoreply") && <LineAutoReplyView />}
            {view === "line-analytics" && canView("line_analytics", "line-analytics") && <LineAnalyticsView />}
            {view === "line-templates" && canView("line_template", "line-templates") && <LineTemplatesView />}
            {view === "line-sources"  && canView("set_source", "line-sources")     && (
              <div className="p-5"><SourceTab /></div>
            )}
            {view === "line-accounts" && canView("line_account", "line-accounts") && <LineAccountsView />}
            {view === "contentset" && canView("content_manage", "contentset") && <ContentSettingsView />}
            {view === "broadcast" && canView("broadcast", "broadcast") && <BroadcastView />}
            {view === "scenario"  && canView("scenario", "scenario")   && <ScenarioView />}
            {view === "suppression" && canView("broadcast", "suppression") && <SuppressionView />}
            {view === "form"      && canView("form", "form")           && <FormView />}
            {view === "master"    && canView("master", "master")       && <MasterView />}
            {view === "payments"  && canView("payment_manage", "payments") && <PaymentView />}
            {view === "refunds"     && canView("refund_manage", "refunds")     && <RefundView />}
            {view === "refundmaster" && canView("refund_master", "refundmaster") && <RefundMasterView />}
            {view === "bookmarks" && canView("bookmarks", "bookmarks")      && <BookmarksView />}
            {view === "mail"      && canView("mail", "mail")                && <MailView />}
            {view === "mailbox"   && canView("mailbox", "mailbox")          && <MailboxView />}
            {view === "mailthreads" && canView("mailthreads", "mailthreads") && <MailThreadsView />}
            {view === "bot"          && can("bot") && <BotChatView />}
            {view === "bot-settings" && can("bot_manage") && <BotSettingsView />}
            {view === "notification" && can("notification") && <NotificationView />}
            {view === "tutorial"  && <TutorialView onBack={() => setView("home")} />}
            {view === "help"      && can("help") && <HelpView onOpen={goSidebar} />}
          </main>
        </div>
      </div>

      {dupTask && (
        <NewTaskModal tasks={tasks} initialTask={dupTask} onClose={() => setDupTask(null)} onSave={handleSave} />
      )}
    </MasterContext.Provider>
    </ConfirmProvider>
    </ToastProvider>
  );
}
