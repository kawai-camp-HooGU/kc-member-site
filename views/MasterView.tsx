"use client";
import { useState } from "react";
import { useMaster } from "../hooks/useMaster";
import {
  supabase, fromProject, fromAnken, toProject, toAnken, toTask, saveTemplateToDb,
} from "../lib/supabase";
import type { TablesInsert } from "../lib/database.types";
import { addDays } from "../lib/dateUtils";
import { projectBar } from "../lib/constants";
import { MEMBER_ROLES, PERM_ROWS } from "../lib/seed";
import { errMessage } from "../lib/errors";
import type { Project, Anken, Member, Role } from "../lib/models";
import { InlineForm } from "../components/common/InlineForm";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { ProjectFormFields } from "../components/master/ProjectFormFields";
import { AnkenFormFields } from "../components/master/AnkenFormFields";
import { NotifyTab } from "../components/master/NotifyTab";
import { projectFormValid } from "../components/master/formTypes";
import type { ProjectForm, AnkenForm } from "../components/master/formTypes";
import { TemplateTab } from "../components/template/TemplateTab";
import { TemplateFormModal } from "../components/template/TemplateFormModal";
import { ApplyTemplateModal } from "../components/template/ApplyTemplateModal";
import type { EditTemplate } from "../components/template/types";
import type { Template } from "../lib/models";

interface Msg { ok: boolean; text: string; }
interface InviteMsg { ok: boolean; msg: string; }
interface EditMember {
  id: number | null; old: string | null; name: string; role: string;
  email: string; company: string; chatId: string; userId: string | null;
}
interface PendingInvite {
  userId: string; invitedAt: string | null; email: string; name: string; company: string; role: string; chatId: string;
}

export function MasterView() {
  const { projects, setProjects, anken, setAnken, members, setMembers, templates, setTemplates, setTasks, permission } = useMaster();
  const [tab, setTab] = useState<string>("project");

  // ── テンプレート適用ロジック ──
  const applyTemplate = async (projectId: number, startDate: string, templateId: number | null) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template || !startDate) return;
    const offNum = (v: number | string | null | undefined): number | null => (v === "" || v == null) ? null : Number(v);
    for (const ta of template.anken) {
      const ends = ta.tasks.map((t) => offNum(t.endOffset)).filter((v): v is number => v != null);
      const maxEnd = ends.length > 0 ? Math.max(...ends) : 30;
      const ankenRow: TablesInsert<"anken"> = {
        project_id: Number(projectId), name: ta.name, leader: "", risk: "normal", progress: 0,
        last_updated: new Date().toISOString().slice(0, 10),
        tasks_due_this_week: 0, tasks_delayed: 0, tasks_completed: 0, due_date: addDays(startDate, maxEnd),
      };
      const { data: newAnken, error: ae } = await supabase.from("anken").insert(ankenRow).select().single();
      if (ae || !newAnken) { console.error("anken insert:", ae); continue; }
      setAnken((prev) => [...prev, toAnken(newAnken)]);

      for (const tt of ta.tasks) {
        const so = offNum(tt.startOffset), eo = offNum(tt.endOffset);
        const taskRow: TablesInsert<"tasks"> = {
          project_id: Number(projectId), anken_id: newAnken.id, name: tt.name, assignees: [],
          start_date: so == null ? null : addDays(startDate, so),
          end_date: eo == null ? null : addDays(startDate, eo),
          status: "pending", risk: "normal",
          importance: (tt.importance && tt.importance !== "none") ? Number(tt.importance) : null,
          progress_memo: tt.progressMemo ?? "", special_notes: tt.specialNotes ?? "", materials: tt.materials ?? "",
        };
        const { data: newTask, error: te } = await supabase.from("tasks").insert(taskRow).select().single();
        if (te || !newTask) { console.error("task insert:", te); continue; }
        setTasks((prev) => [...prev, toTask(newTask)]);
      }
    }
  };

  // ── プロジェクト CRUD ──
  const [projForm, setProjForm]               = useState<ProjectForm | null>(null);
  const [projConfirm, setProjConfirm]         = useState<number | null>(null);
  const [applyProjTarget, setApplyProjTarget] = useState<Project | null>(null);

  const saveProject = async (f: ProjectForm) => {
    if (f.id) {
      const { error } = await supabase.from("projects").update(fromProject(f as Project)).eq("id", f.id);
      if (!error) setProjects((prev) => prev.map((p) => p.id === f.id ? ({ ...p, ...f } as Project) : p));
    } else {
      const row: TablesInsert<"projects"> = { ...fromProject(f as Project), risk: "normal", progress: 0, tasks_due_this_week: 0, tasks_delayed: 0, tasks_completed: 0 };
      const { data, error } = await supabase.from("projects").insert(row).select().single();
      if (!error && data) {
        const newProj = toProject(data);
        setProjects((prev) => [...prev, newProj]);
        if (f.templateId && f.startDate) await applyTemplate(newProj.id, f.startDate, f.templateId);
      }
    }
    setProjForm(null);
  };

  const deleteProject = async (id: number) => {
    const { error } = await supabase.from("projects").update({ is_deleted: true }).eq("id", id);
    if (!error) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setAnken((prev) => prev.filter((a) => a.projectId !== id));
      setTasks((prev) => prev.filter((t) => t.projectId !== id));
    }
    setProjConfirm(null);
    setProjForm(null);
  };

  // ── テンプレート CRUD ──
  const [templateForm, setTemplateForm]       = useState<Template | null>(null);
  const [templateConfirm, setTemplateConfirm] = useState<number | null>(null);

  const saveTemplate = async (f: EditTemplate) => {
    try {
      const savedId = await saveTemplateToDb(f as unknown as Template);
      if (f.id) setTemplates((prev) => prev.map((t) => t.id === f.id ? ({ ...t, ...f } as unknown as Template) : t));
      else setTemplates((prev) => [...prev, { ...f, id: savedId } as unknown as Template]);
    } catch (err) {
      console.error("テンプレート保存エラー:", err);
    }
    setTemplateForm(null);
  };

  const deleteTemplate = async (id: number) => {
    const { error } = await supabase.from("templates").update({ is_deleted: true }).eq("id", id);
    if (!error) setTemplates((prev) => prev.filter((t) => t.id !== id));
    setTemplateConfirm(null);
    setTemplateForm(null);
  };

  const persistTemplate = async (tmpl: EditTemplate): Promise<number | undefined> => {
    try {
      const savedId = await saveTemplateToDb(tmpl as unknown as Template);
      const id = tmpl.id ?? savedId;
      const withId = { ...tmpl, id } as unknown as Template;
      setTemplates((prev) => prev.some((t) => t.id === id) ? prev.map((t) => t.id === id ? withId : t) : [...prev, withId]);
      return id;
    } catch (e) { console.error("テンプレート保存エラー:", e); return undefined; }
  };
  const createTemplate = async (name: string) => {
    const nm = (name || "").trim();
    if (!nm) return;
    await persistTemplate({ id: null, name: nm, anken: [] });
  };

  // ── 分類 CRUD ──
  const [ankenForm, setAnkenForm]       = useState<AnkenForm | null>(null);
  const [ankenConfirm, setAnkenConfirm] = useState<number | null>(null);
  const [openAnkenProjects, setOpenAnkenProjects] = useState<Set<number>>(() => new Set());

  const saveAnken = async (f: AnkenForm) => {
    if (f.id) {
      const { error } = await supabase.from("anken").update(fromAnken(f as Anken, members)).eq("id", f.id);
      if (!error) setAnken((prev) => prev.map((a) => a.id === f.id ? ({ ...a, ...f } as Anken) : a));
    } else {
      const row: TablesInsert<"anken"> = { ...fromAnken(f as Anken, members), risk: "normal", progress: 0, last_updated: new Date().toISOString().slice(0, 10), tasks_due_this_week: 0, tasks_delayed: 0, tasks_completed: 0 };
      const { data, error } = await supabase.from("anken").insert(row).select().single();
      if (!error && data) setAnken((prev) => [...prev, toAnken(data, Object.fromEntries(members.map((m) => [m.id, m])))]);
    }
    setAnkenForm(null);
  };

  const deleteAnken = async (id: number) => {
    const { error } = await supabase.from("anken").update({ is_deleted: true }).eq("id", id);
    if (!error) {
      setAnken((prev) => prev.filter((a) => a.id !== id));
      setTasks((prev) => prev.filter((t) => t.ankenId !== id));
    }
    setAnkenConfirm(null);
    setAnkenForm(null);
  };

  // ── メンバー CRUD ──
  const [memberInput,   setMemberInput]   = useState("");
  const [memberRole,    setMemberRole]    = useState("メンバー");
  const [memberEmail,   setMemberEmail]   = useState("");
  const [memberCompany, setMemberCompany] = useState("");
  const [memberChatId,  setMemberChatId]  = useState("");
  const [memberSearch,  setMemberSearch]  = useState("");
  const [memberLinkFilter, setMemberLinkFilter] = useState("all");
  const [showPermHelp, setShowPermHelp] = useState(false);
  const [editMember,    setEditMember]    = useState<EditMember | null>(null);
  const [memberConfirm, setMemberConfirm] = useState<{ id: number; name: string } | null>(null);
  const [memberLinking, setMemberLinking] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwNew,  setPwNew]  = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg,  setPwMsg]  = useState<Msg | null>(null);
  const [acctMsg, setAcctMsg] = useState<Msg | null>(null);
  const openMemberEdit = (m: Member) => {
    setPwOpen(false); setPwNew(""); setPwNew2(""); setPwMsg(null); setAcctMsg(null);
    setEditMember({ id: m.id, old: m.name, name: m.name, role: m.role, email: m.email ?? "", company: m.company ?? "", chatId: m.chatId ?? "", userId: m.userId });
  };
  const sendResetEmail = async () => {
    if (!editMember?.email?.trim()) { setAcctMsg({ ok: false, text: "メールアドレスが未設定です" }); return; }
    setAcctMsg(null);
    try {
      const redirectTo = (typeof window !== "undefined" ? window.location.origin : "") + "/set-password";
      const { error } = await supabase.auth.resetPasswordForEmail(editMember.email.trim(), { redirectTo });
      if (error) throw new Error(error.message);
      setAcctMsg({ ok: true, text: "パスワードリセットメールを送信しました" });
    } catch (e) {
      setAcctMsg({ ok: false, text: errMessage(e) });
    }
  };
  const openMemberAdd = () => {
    setPwOpen(false); setPwNew(""); setPwNew2(""); setPwMsg(null); setAcctMsg(null);
    setEditMember({ id: null, old: null, name: "", role: "メンバー", email: "", company: "", chatId: "", userId: null });
  };
  const inviteFromModal = async () => {
    if (!editMember) return;
    const name = (editMember.name || "").trim();
    const email = (editMember.email || "").trim();
    if (!name || !email) { setAcctMsg({ ok: false, text: "招待には表示名とメールアドレスが必要です" }); return; }
    setMemberLinking(true); setAcctMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email, name, role: editMember.role, company: (editMember.company || "").trim(), chatId: (editMember.chatId || "").trim(), memberId: editMember.id }),
      });
      const json = (await res.json()) as { error?: string; userId?: string };
      if (!res.ok) throw new Error(json.error ?? "招待に失敗しました");
      const newFields = { name, role: editMember.role as Role, email, company: (editMember.company || "").trim(), chatId: (editMember.chatId || "").trim(), userId: json.userId ?? null };
      setMembers((prev) => {
        const idx = editMember.id != null ? prev.findIndex((m) => m.id === editMember.id) : prev.findIndex((m) => m.name === name && !m.userId);
        if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, ...newFields } : m);
        return [...prev, newFields as Member];
      });
      if (editMember.id == null) setEditMember(null);
      else { setEditMember((v) => v ? { ...v, userId: json.userId ?? null } : v); setAcctMsg({ ok: true, text: `${email} に招待メールを送信しました` }); }
    } catch (e) {
      setAcctMsg({ ok: false, text: errMessage(e) });
    } finally {
      setMemberLinking(false);
    }
  };
  const myRole = permission?.role;
  const assignableRoles = myRole === "admin" ? MEMBER_ROLES
    : myRole === "leader" ? MEMBER_ROLES.filter((r) => r !== "管理者")
    : MEMBER_ROLES;
  const canEditMember = (m: Member) => myRole === "admin" ? true : myRole === "leader" ? m.role !== "管理者" : false;
  const submitPasswordReset = async () => {
    if (!editMember?.userId) return;
    if (pwNew.length < 6)  { setPwMsg({ ok: false, text: "パスワードは6文字以上で入力してください" }); return; }
    if (pwNew !== pwNew2)  { setPwMsg({ ok: false, text: "確認用パスワードが一致しません" }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: editMember.userId, newPassword: pwNew }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "再設定に失敗しました");
      setPwMsg({ ok: true, text: "パスワードを再設定しました" });
      setPwNew(""); setPwNew2("");
    } catch (e) {
      setPwMsg({ ok: false, text: errMessage(e) });
    } finally {
      setPwBusy(false);
    }
  };
  const [inviteResult,  setInviteResult]  = useState<InviteMsg | null>(null);
  const [inviteMemberId, setInviteMemberId] = useState<number | null>(null);
  const [inviteLinkName, setInviteLinkName] = useState("");

  const [showPending,    setShowPending]    = useState(false);
  const [pendingList,    setPendingList]    = useState<PendingInvite[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError,   setPendingError]   = useState("");
  const [cancelingId,    setCancelingId]    = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ userId: string; name: string; email: string } | null>(null);

  const loadPendingInvites = async () => {
    setPendingLoading(true); setPendingError("");
    try {
      const res  = await fetch("/api/invite", { method: "GET" });
      const json = (await res.json()) as { error?: string; invites?: PendingInvite[] };
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setPendingList(json.invites ?? []);
    } catch (err) {
      setPendingError(errMessage(err));
    } finally {
      setPendingLoading(false);
    }
  };
  const openPending = () => { setShowPending(true); loadPendingInvites(); };
  const cancelInvite = async (userId: string) => {
    setCancelingId(userId); setPendingError("");
    try {
      const res  = await fetch("/api/invite", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "取り消しに失敗しました");
      setPendingList((prev) => prev.filter((p) => p.userId !== userId));
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setPendingError(errMessage(err));
    } finally {
      setCancelingId(null); setPendingConfirm(null);
    }
  };

  const fetchUserIdByEmail = async (email: string): Promise<string | null> => {
    const trimmed = email.trim();
    if (!trimmed) return null;
    const { data, error } = await supabase.rpc("get_user_id_by_email", { email_input: trimmed });
    if (error || !data) return null;
    return data;
  };

  const startInviteForExisting = (m: Member) => {
    setInviteMemberId(m.id); setInviteLinkName(m.name); setMemberInput(m.name);
    setMemberRole(m.role ?? "メンバー"); setMemberCompany(m.company ?? ""); setMemberChatId(m.chatId ?? ""); setMemberEmail(m.email ?? "");
    setInviteResult(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const clearInviteLink = () => {
    setInviteMemberId(null); setInviteLinkName(""); setMemberInput("");
    setMemberRole("メンバー"); setMemberCompany(""); setMemberChatId(""); setMemberEmail("");
  };
  void startInviteForExisting; void clearInviteLink; void inviteResult;

  const inviteMember = async () => {
    const name  = memberInput.trim();
    const email = memberEmail.trim();
    if (!name || !email) return;
    setMemberLinking(true); setInviteResult(null);
    try {
      const company = memberCompany.trim();
      const chatId  = memberChatId.trim();
      const res  = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name, role: memberRole, company, chatId, memberId: inviteMemberId }) });
      const json = (await res.json()) as { error?: string; userId?: string };
      if (!res.ok) throw new Error(json.error ?? "招待に失敗しました");
      setMembers((prev) => {
        const newFields = { name, role: memberRole as Role, email, company, chatId, userId: json.userId ?? null };
        const idx = inviteMemberId != null ? prev.findIndex((m) => m.id === inviteMemberId) : prev.findIndex((m) => m.name === name);
        if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, ...newFields } : m);
        return [...prev, newFields as Member];
      });
      const linkedNote = inviteMemberId != null ? `（メンバー「${inviteLinkName}」に紐付け）` : "";
      setInviteResult({ ok: true, msg: `${email} に招待メールを送信しました${linkedNote}` });
      setMemberInput(""); setMemberRole("メンバー"); setMemberEmail(""); setMemberCompany(""); setMemberChatId("");
      setInviteMemberId(null); setInviteLinkName("");
    } catch (err) {
      setInviteResult({ ok: false, msg: errMessage(err) });
    } finally {
      setMemberLinking(false);
    }
  };
  void inviteMember;

  const saveMember = async () => {
    if (!editMember || !editMember.name.trim()) return;
    setMemberLinking(true);
    const newName  = editMember.name.trim();
    const userId   = await fetchUserIdByEmail(editMember.email ?? "");
    const updates: TablesInsert<"members"> = { name: newName, role: editMember.role as Role, email: editMember.email?.trim() || null, user_id: userId, company: editMember.company?.trim() || null, chat_id: editMember.chatId?.trim() || null };
    if (editMember.id == null && !editMember.old) {
      const { data, error } = await supabase.from("members").insert(updates).select().single();
      setMemberLinking(false);
      if (!error && data) {
        setMembers((prev) => [...prev, { id: data.id, name: newName, role: editMember.role as Role, email: updates.email ?? "", userId, company: editMember.company?.trim() || "", chatId: editMember.chatId?.trim() || "", isDeleted: false }]);
      }
      setEditMember(null);
      return;
    }
    const q = editMember.id != null
      ? supabase.from("members").update(updates).eq("id", editMember.id)
      : supabase.from("members").update(updates).eq("name", editMember.old!);
    const { error } = await q;
    setMemberLinking(false);
    if (!error) setMembers((prev) => prev.map((m) =>
      (editMember.id != null ? m.id === editMember.id : m.name === editMember.old)
        ? { ...m, name: newName, role: editMember.role as Role, email: updates.email ?? "", userId, company: editMember.company?.trim() || "", chatId: editMember.chatId?.trim() || "" } : m
    ));
    setEditMember(null);
  };

  const deleteMember = async (id: number) => {
    const { error } = await supabase.from("members").update({ is_deleted: true }).eq("id", id);
    if (!error) setMembers((prev) => prev.map((m) => m.id === id ? { ...m, isDeleted: true } : m));
    setMemberConfirm(null);
    setEditMember(null);
  };

  const MASTER_TABS = [
    { key: "project",  label: "プロジェクト" },
    { key: "anken",    label: "分類" },
    { key: "member",   label: "メンバー" },
    { key: "template", label: "テンプレート" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200 pb-0 sticky top-0 z-30 bg-gray-50 -mx-4 px-4 pt-1">
        {MASTER_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-red-600 text-red-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "project" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-400">{projects.length} 件</p>
            <button onClick={() => setProjForm({ name: "", abbreviation: "", startDate: "", dueDate: "", closeDate: "", notifyChat: "", memberNames: [], templateId: null })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">＋ 追加</button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {projects.map((p, i) => (
              <div key={p.id} className={`flex items-center px-4 py-3 gap-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                <div className="flex-1 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 text-white px-2.5 py-0.5 rounded-md ${projectBar(p.id)}`}>
                    <span className="text-[10px] font-bold border border-white/50 rounded px-1 leading-none">PJ</span>
                    <span className="text-sm font-semibold leading-none">{p.name}</span>
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    {p.startDate ? `開始：${p.startDate}` : ""}
                    {p.startDate && p.dueDate ? "　" : ""}
                    {p.dueDate ? `期限：${p.dueDate}` : ""}
                    {(p.memberNames ?? []).length > 0 ? `${p.startDate || p.dueDate ? "　" : ""}メンバー：${p.memberNames.join("・")}` : ""}
                  </p>
                </div>
                <button onClick={() => setApplyProjTarget(p)}
                  className="text-xs text-purple-500 hover:text-purple-700 px-2 py-1 border border-purple-200 rounded-md hover:bg-purple-50 transition-colors whitespace-nowrap">テンプレ適用</button>
                <button onClick={() => setProjForm({ ...p })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
              </div>
            ))}
          </div>

          {projForm && (
            <InlineForm title={projForm.id ? "プロジェクト編集" : "プロジェクト追加"}
              onClose={() => setProjForm(null)}
              onSave={() => saveProject(projForm)}
              onDelete={projForm.id ? () => setProjConfirm(projForm.id!) : undefined}
              canSave={projectFormValid(projForm)}>
              <ProjectFormFields form={projForm} setForm={setProjForm as React.Dispatch<React.SetStateAction<ProjectForm>>} members={members} templates={projForm.id ? undefined : templates} />
            </InlineForm>
          )}
        </div>
      )}

      {tab === "anken" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-400">{anken.length} 件 ／ {projects.filter((p) => anken.some((a) => a.projectId === p.id)).length} プロジェクト</p>
            <button onClick={() => setAnkenForm({ name: "", abbreviation: "", projectId: projects[0]?.id ?? 1, leader: "", dueDate: "" })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">＋ 追加</button>
          </div>

          <div className="space-y-2">
            {projects.filter((p) => anken.some((a) => a.projectId === p.id)).map((p) => {
              const list = anken.filter((a) => a.projectId === p.id);
              const open = openAnkenProjects.has(p.id);
              const toggle = () => setOpenAnkenProjects((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; });
              return (
                <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-white cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
                    <span className="text-gray-400 text-sm w-4 text-center shrink-0">{open ? "▼" : "▶"}</span>
                    <span className={`inline-flex items-center gap-1.5 text-white px-2.5 py-0.5 rounded-md shrink-0 ${projectBar(p.id)}`}>
                      <span className="text-[10px] font-bold border border-white/50 rounded px-1 leading-none">PJ</span>
                      <span className="text-sm font-semibold leading-none">{p.name}</span>
                    </span>
                    <span className="text-xs text-gray-400">{list.length} 分類</span>
                    <button onClick={(e) => { e.stopPropagation(); setAnkenForm({ name: "", abbreviation: "", projectId: p.id, leader: "", dueDate: "" }); }}
                      className="ml-auto text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-md px-2 py-1 hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0">＋ 追加</button>
                  </div>
                  {open && list.map((a) => (
                    <div key={a.id} className="flex items-center px-4 py-3 gap-3 border-t border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                        <p className="text-xs text-gray-400">{a.leader ? `リーダー：${a.leader}` : ""}{a.dueDate ? `　期限：${a.dueDate}` : ""}</p>
                      </div>
                      <button onClick={() => setAnkenForm({ ...a })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {ankenForm && (
            <InlineForm title={ankenForm.id ? "分類編集" : "分類追加"}
              onClose={() => setAnkenForm(null)}
              onSave={() => saveAnken(ankenForm)}
              onDelete={ankenForm.id ? () => setAnkenConfirm(ankenForm.id!) : undefined}
              canSave={!!ankenForm.name?.trim()}>
              <AnkenFormFields form={ankenForm} setForm={setAnkenForm as React.Dispatch<React.SetStateAction<AnkenForm>>} members={members} projects={projects} />
            </InlineForm>
          )}
        </div>
      )}

      {tab === "member" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={openPending} className="text-sm text-red-600 hover:text-red-800 underline whitespace-nowrap">招待中の一覧を確認する</button>
              <button type="button" onClick={() => setShowPermHelp(true)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 whitespace-nowrap">🛈 権限早見表</button>
            </div>
            <button onClick={openMemberAdd} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 shrink-0">＋ 追加</button>
          </div>

          <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white">
            <span className="text-gray-400 text-sm">🔍</span>
            <input className="flex-1 text-sm focus:outline-none bg-transparent" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="メンバーを検索…（名前・会社名・ChatWorkアカウントID）" />
            {memberSearch && <button onClick={() => setMemberSearch("")} className="text-gray-400 hover:text-gray-600 text-sm">×</button>}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">メール紐づけ</span>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {[{ k: "all", l: "すべて" }, { k: "linked", l: "紐づけ済" }, { k: "unlinked", l: "未紐づけ" }].map((o) => (
                <button key={o.k} onClick={() => setMemberLinkFilter(o.k)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${memberLinkFilter === o.k ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>{o.l}</button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {(() => {
              const q = memberSearch.trim().toLowerCase();
              const activeMembers = members.filter((m) => !m.isDeleted);
              const searched = q ? activeMembers.filter((m) => [m.name, m.company, m.chatId, m.email].some((v) => (v ?? "").toLowerCase().includes(q))) : activeMembers;
              const filteredMembers = memberLinkFilter === "linked" ? searched.filter((m) => m.userId)
                                    : memberLinkFilter === "unlinked" ? searched.filter((m) => !m.userId)
                                    : searched;
              return (<>
            {activeMembers.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">メンバーがいません</div>}
            {activeMembers.length > 0 && filteredMembers.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">該当するメンバーがいません</div>}
            {filteredMembers.map((m, i) => (
              <div key={m.name} className={`px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">{m.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{m.name}{m.company && <span className="text-xs text-gray-400 ml-1.5">／ {m.company}</span>}</p>
                    {m.email && (
                      <p className="text-xs text-gray-400 truncate">{m.email}
                        <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${m.userId ? "bg-green-50 text-green-600" : "bg-yellow-50 text-yellow-600"}`}>{m.userId ? "紐づけ済" : "未紐づけ"}</span>
                      </p>
                    )}
                    {!m.email && <p className="text-xs text-gray-300">メールアドレス未設定</p>}
                    {m.chatId && <p className="text-xs text-gray-400 truncate">💬 {m.chatId}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                    m.role === "管理者" ? "bg-red-50 text-red-600 border-red-200" :
                    m.role === "リーダー" ? "bg-blue-50 text-red-600 border-red-200" :
                    m.role === "外部" ? "bg-gray-50 text-gray-500 border-gray-200" :
                    "bg-green-50 text-green-600 border-green-200"}`}>{m.role}</span>
                  {canEditMember(m)
                    ? <button onClick={() => openMemberEdit(m)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
                    : <span className="text-xs text-gray-300 px-2 py-1 shrink-0" title="管理者は編集できません">編集</span>}
                </div>
              </div>
            ))}
              </>);
            })()}
          </div>
        </div>
      )}

      {tab === "template" && (
        <TemplateTab templates={templates} onPersist={persistTemplate} onCreate={createTemplate} onDelete={(id) => setTemplateConfirm(id)} />
      )}

      {tab === "notify" && <NotifyTab />}

      {editMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditMember(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">メンバーを編集</h2>
              <button onClick={() => setEditMember(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">表示名 <span className="text-red-500">*</span></label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.name} onChange={(e) => setEditMember((v) => v ? { ...v, name: e.target.value } : v)} autoFocus placeholder="表示名 *" />
                </div>
                <div className="w-32">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">権限</label>
                  <select className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400"
                    value={editMember.role} onChange={(e) => setEditMember((v) => v ? { ...v, role: e.target.value } : v)}>
                    {assignableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">会社名</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.company ?? ""} onChange={(e) => setEditMember((v) => v ? { ...v, company: e.target.value } : v)} placeholder="会社名" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-500">ChatWork アカウントID（数字）</label>
                  </div>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.chatId ?? ""} onChange={(e) => setEditMember((v) => v ? { ...v, chatId: e.target.value } : v)} placeholder="ChatWork アカウントID（数字）" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">メールアドレス</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                  type="email" value={editMember.email ?? ""} onChange={(e) => setEditMember((v) => v ? { ...v, email: e.target.value } : v)}
                  placeholder="メールアドレス（Supabaseアカウントと紐づけ）" />
                {editMember.email?.trim() && <p className="text-xs text-gray-400 mt-1.5">保存時に Supabase アカウントと紐づけます。</p>}
              </div>

              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">アカウント操作</span>
                  <span className="flex items-center gap-1.5">
                    {editMember.userId
                      ? <span className="text-[11px] bg-green-50 text-green-600 border border-green-200 rounded-full px-2 py-0.5">紐づけ済</span>
                      : <span className="text-[11px] bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full px-2 py-0.5">未紐づけ</span>}
                  </span>
                </div>

                {!editMember.userId && (
                  <>
                    <button onClick={inviteFromModal} disabled={memberLinking}
                      className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors">
                      ✉ {memberLinking ? "送信中..." : "招待メールを送信"}
                    </button>
                    {acctMsg && <p className={`text-xs ${acctMsg.ok ? "text-green-600" : "text-red-500"}`}>{acctMsg.text}</p>}
                    <p className="text-[11px] text-gray-400">招待には表示名とメールアドレスが必要です。送信するとメンバーに登録されます。</p>
                  </>
                )}

                {editMember.userId && (
                  <>
                    <button onClick={sendResetEmail}
                      className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-red-200 bg-blue-50 text-red-700 hover:bg-red-100 transition-colors">
                      🔑 パスワードリセットメールを送信
                    </button>
                    {acctMsg && <p className={`text-xs ${acctMsg.ok ? "text-green-600" : "text-red-500"}`}>{acctMsg.text}</p>}

                    <button onClick={() => { setPwOpen((o) => !o); setPwMsg(null); }}
                      className="w-full flex items-center justify-between gap-2 text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">
                      <span>🛡 パスワードを再設定（管理者）</span>
                      <span className="text-gray-400 text-xs">{pwOpen ? "▲" : "▼"}</span>
                    </button>
                    {pwOpen && (
                      <div className="space-y-2 pt-1">
                        <input type="password" value={pwNew} onChange={(e) => { setPwNew(e.target.value); setPwMsg(null); }}
                          placeholder="新しいパスワード（6文字以上）" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
                        <input type="password" value={pwNew2} onChange={(e) => { setPwNew2(e.target.value); setPwMsg(null); }}
                          placeholder="新しいパスワード（確認）" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
                        {pwMsg && <p className={`text-xs ${pwMsg.ok ? "text-green-600" : "text-red-500"}`}>{pwMsg.text}</p>}
                        <button onClick={submitPasswordReset} disabled={pwBusy}
                          className="w-full text-sm py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          {pwBusy ? "変更中..." : "このパスワードに変更する"}</button>
                        <p className="text-[11px] text-gray-400">管理者がこのユーザーのログインパスワードを直接再設定します。</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 items-center">
              {editMember.id != null && (
                <button onClick={() => setMemberConfirm({ id: editMember.id!, name: editMember.name })}
                  className="text-sm py-2.5 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">削除</button>
              )}
              <div className="flex-1" />
              <button onClick={() => setEditMember(null)} className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">キャンセル</button>
              <button onClick={saveMember} disabled={memberLinking || !editMember.name.trim()}
                className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {memberLinking ? "処理中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {showPermHelp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPermHelp(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">権限設定 早見表</h2>
              <button onClick={() => setShowPermHelp(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left font-medium py-2 px-2" style={{ width: "34%" }}>機能 / 操作</th>
                    <th className="py-2 px-1"><span className="bg-red-50 text-red-600 rounded-full px-2 py-0.5">管理者</span></th>
                    <th className="py-2 px-1"><span className="bg-blue-50 text-red-700 rounded-full px-2 py-0.5">リーダー</span></th>
                    <th className="py-2 px-1"><span className="bg-green-50 text-green-700 rounded-full px-2 py-0.5">メンバー</span></th>
                    <th className="py-2 px-1"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">外部</span></th>
                  </tr>
                </thead>
                <tbody>
                  {PERM_ROWS.map((r, i) => (
                    <tr key={i} className={`border-t border-gray-100 ${i % 2 ? "bg-gray-50" : ""}`}>
                      <td className="py-2 px-2 text-gray-700">{r.f}</td>
                      {r.v.map((cell, j) => (
                        <td key={j} className="py-2 px-1 text-center font-medium" style={{ color: cell.c }}>{cell.t}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                ○＝可 ／ △＝条件付き ／ ✕＝不可。「担当PJ」＝プロジェクトの「メンバー」設定に自分が含まれるPJ。
                招待で付与できるロール：管理者＝全ロール／リーダー＝リーダー以下。権限はクライアント・サーバ双方で検証します。
              </p>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-gray-100">
              <button onClick={() => setShowPermHelp(false)} className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {projConfirm     && <ConfirmDialog message="このプロジェクトと紐づく分類をすべて削除します。よろしいですか？" onCancel={() => setProjConfirm(null)}     onConfirm={() => deleteProject(projConfirm)} />}
      {ankenConfirm    && <ConfirmDialog message="この分類を削除します。よろしいですか？"                           onCancel={() => setAnkenConfirm(null)}    onConfirm={() => deleteAnken(ankenConfirm)} />}
      {memberConfirm   && <ConfirmDialog message={`「${memberConfirm.name}」を削除します。よろしいですか？`}        onCancel={() => setMemberConfirm(null)}   onConfirm={() => deleteMember(memberConfirm.id)} />}
      {templateConfirm && <ConfirmDialog message="このテンプレートを削除します。よろしいですか？"                    onCancel={() => setTemplateConfirm(null)} onConfirm={() => deleteTemplate(templateConfirm)} />}

      {templateForm && <TemplateFormModal form={templateForm} onClose={() => setTemplateForm(null)} onSave={saveTemplate} onDelete={templateForm.id ? () => setTemplateConfirm(templateForm.id!) : undefined} />}

      {applyProjTarget && (
        <ApplyTemplateModal project={applyProjTarget} onClose={() => setApplyProjTarget(null)}
          onApply={(templateId, baseDate) => { applyTemplate(applyProjTarget.id, baseDate, templateId); setApplyProjTarget(null); }} />
      )}

      {showPending && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPending(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-semibold text-gray-800">招待中の一覧</p>
                <p className="text-xs text-gray-400 mt-0.5">アカウント作成（パスワード設定）が未完了の招待</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadPendingInvites} disabled={pendingLoading} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 disabled:opacity-40">↻ 更新</button>
                <button onClick={() => setShowPending(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">×</button>
              </div>
            </div>
            <div className="overflow-auto p-3">
              {pendingError && <div className="text-xs px-3 py-2 mb-2 rounded-lg bg-red-50 text-red-600 border border-red-200">{pendingError}</div>}
              {pendingLoading ? (
                <div className="text-center text-gray-400 text-sm py-10">読み込み中...</div>
              ) : pendingList.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-10">招待中のメンバーはいません</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-left">
                      <th className="px-2 py-2 font-medium whitespace-nowrap">招待日時</th>
                      <th className="px-2 py-2 font-medium">メールアドレス</th>
                      <th className="px-2 py-2 font-medium whitespace-nowrap">氏名</th>
                      <th className="px-2 py-2 font-medium whitespace-nowrap">会社名</th>
                      <th className="px-2 py-2 font-medium whitespace-nowrap">権限</th>
                      <th className="px-2 py-2 font-medium whitespace-nowrap">ChatWork ID</th>
                      <th className="px-2 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    {pendingList.map((p) => (
                      <tr key={p.userId} className="border-t border-gray-100">
                        <td className="px-2 py-2 text-gray-500 whitespace-nowrap">
                          {p.invitedAt ? new Date(p.invitedAt).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="px-2 py-2 break-all">{p.email || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{p.name || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{p.company || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {p.role
                            ? <span className={`px-2 py-0.5 rounded-full border ${
                                p.role === "管理者" ? "bg-red-50 text-red-600 border-red-200" :
                                p.role === "リーダー" ? "bg-blue-50 text-red-600 border-red-200" :
                                p.role === "外部" ? "bg-gray-50 text-gray-500 border-gray-200" :
                                "bg-green-50 text-green-600 border-green-200"}`}>{p.role}</span>
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{p.chatId || "—"}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setPendingConfirm({ userId: p.userId, name: p.name, email: p.email })} disabled={cancelingId === p.userId}
                            className="text-xs border border-red-300 text-red-500 hover:bg-red-50 rounded-md px-2 py-1 disabled:opacity-40">
                            {cancelingId === p.userId ? "取消中..." : "招待を取り消す"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button onClick={() => setShowPending(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <ConfirmDialog message={`「${pendingConfirm.name || pendingConfirm.email}」の招待を取り消します。\n認証ユーザーとメンバーデータを削除します。よろしいですか？`}
          onCancel={() => setPendingConfirm(null)} onConfirm={() => cancelInvite(pendingConfirm.userId)} />
      )}
    </div>
  );
}
