"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import {
  supabase, fetchAllData, fromTask,
  toProject, toAnken, toTask, toMember,
} from "./lib/supabase";
import type { Tables } from "./lib/database.types";
import type { Project, Anken, Task, Member, Template, MemberById } from "./lib/models";
import { DEFAULT_FILTERS } from "./lib/filters";
import type { Filters } from "./lib/filters";
import { usePermission } from "./hooks/usePermission";
import { MasterContext } from "./hooks/useMaster";
import { INITIAL_PROJECTS, INITIAL_ANKEN, INITIAL_TASKS, INITIAL_MEMBERS, INITIAL_TEMPLATES } from "./lib/seed";
import { SidebarContent } from "./components/layout/SidebarContent";
import { LogoMark } from "./components/layout/LogoMark";
import { ViewTabs } from "./components/layout/ViewTabs";
import { HelpView } from "./components/layout/HelpView";
import { ContentView } from "./components/content/ContentView";
import { ContentSettingsView } from "./components/content/ContentSettingsView";
import { NewTaskModal } from "./components/task/NewTaskModal";
import { DashboardView } from "./views/DashboardView";
import { KanbanView } from "./views/KanbanView";
import { GanttView } from "./views/GanttView";
import { CalendarView } from "./views/CalendarView";
import { BulkRegisterView } from "./views/BulkRegisterView";
import { MasterView } from "./views/MasterView";

export default function App() {
  const router = useRouter();
  const [view, setView]       = useState<string>("dashboard");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [ganttFromProject, setGanttFromProject] = useState(false);
  const goSidebar = (k: string) => { setFilters(DEFAULT_FILTERS); setGanttFromProject(false); setView(k); };
  const goTab = (k: string) => { setView(k); };
  const goProjectView = (k: string, pid: number) => { setFilters({ ...DEFAULT_FILTERS, project: [String(pid)] }); setGanttFromProject(k === "gantt"); setView(k); };
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
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); setLoading(false); return; }
      setUser(session.user);
      loadData().finally(() => setLoading(false));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) router.push("/login");
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          return i >= 0 ? p.map((x, idx) => idx === i ? m : x) : [...p, m];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "members" }, (payload) => {
        const r = payload.new as Tables<"members">;
        const m = toMember(r);
        const byId = memberByIdNow();
        byId[m.id] = m;
        setMembers((p) => p.some((x) => x.id === m.id) ? p.map((x) => x.id === m.id ? m : x) : [...p, m]);
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

  return (
    <MasterContext.Provider value={{ projects, setProjects, anken, setAnken, members, setMembers, templates, setTemplates, tasks, setTasks, permission }}>
      <div className="min-h-screen bg-gray-50 font-sans flex">
        <aside className="hidden sm:flex sm:flex-col w-56 shrink-0 bg-neutral-900 sticky top-0 h-screen">
          <SidebarContent view={view} onSelect={goSidebar} permission={permission}
            user={user} userInitial={userInitial} onSignOut={handleSignOut} />
        </aside>

        {drawerOpen && (
          <div className="sm:hidden fixed inset-0 z-50 flex">
            <div className="w-60 max-w-[80%] bg-neutral-900 h-full shadow-2xl">
              <SidebarContent view={view} onSelect={goSidebar} permission={permission}
                user={user} userInitial={userInitial} onSignOut={handleSignOut}
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
              <span className="text-sm font-bold tracking-wide"><span className="text-gray-900">KAWAI</span><span className="text-red-600"> CAMP</span></span>
            </div>
            <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm">{userInitial}</div>
          </header>

          <main className="max-w-6xl w-full mx-auto px-4 py-6">
            {["kanban", "gantt", "calendar"].includes(view) && <ViewTabs view={view} onChange={goTab} filters={filters} projects={projects} anken={anken} />}
            {view === "dashboard" && <DashboardView tasks={activeTasks} onOpenView={goProjectView} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "kanban"    && <KanbanView    tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "gantt"     && <GanttView     tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} hideProjectCol={ganttFromProject} onOpenBulk={() => setView("bulkadd")} />}
            {view === "calendar"  && <CalendarView  tasks={activeTasks} filters={filters} onFiltersChange={setFilters} onSave={handleSave} onDelete={handleDelete} onDuplicate={setDupTask} />}
            {view === "bulkadd"   && <BulkRegisterView tasks={tasks} filters={filters} onSave={handleSave} onDone={(pid) => goProjectView("gantt", pid)} onCancel={() => setView("gantt")} />}
            {view === "content"    && <ContentView />}
            {view === "contentset" && <ContentSettingsView />}
            {view === "master"    && <MasterView />}
            {view === "help"      && <HelpView />}
          </main>
        </div>
      </div>

      {dupTask && (
        <NewTaskModal tasks={tasks} initialTask={dupTask} onClose={() => setDupTask(null)} onSave={handleSave} />
      )}
    </MasterContext.Provider>
  );
}
