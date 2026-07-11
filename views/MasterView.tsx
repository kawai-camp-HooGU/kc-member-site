"use client";
import { useState, useEffect, useMemo } from "react";
import { useMaster } from "../hooks/useMaster";
import {
  supabase, fromProject, fromAnken, toProject, toAnken, toTask, saveTemplateToDb, loadAppSettings,
} from "../lib/supabase";
import type { TablesInsert } from "../lib/database.types";
import { addDays } from "../lib/dateUtils";
import { projectBar } from "../lib/constants";
import { MEMBER_ROLES, PERM_ROWS } from "../lib/seed";
import { errMessage } from "../lib/errors";
import { apiFetch } from "../lib/apiClient";
import type { Project, Anken, Member, Role, MemberMemo } from "../lib/models";
import { permKey, saveRolePermission } from "../lib/permissions";
import { PermissionTab } from "../components/master/PermissionTab";
import type { PermChange } from "../components/master/PermissionTab";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { fetchContentData } from "../lib/contents";
import type { ContentPage, CmsContent } from "../lib/models";
import {
  fetchContentViews, buildViewIndex, buildProgressMap, memberProgress, visibleContentsFor,
  loginState, LOGIN_STATE_LABEL, relDays, fmtDateTime,
} from "../lib/engagement";
import type { ContentViewRow } from "../lib/engagement";
import {
  buildAttrIndex, filterMembers, sortMembers, activeFilterCount, isDefaultSort,
  attrSegs, attrLabel, saveMemberExtras, ATTR_MODE_LABEL, DEFAULT_FILTER, DEFAULT_SORT,
  notifyState, NOTIFY_FILTER_OPTIONS, LOGIN_FILTER_OPTIONS, PROGRESS_FILTER_OPTIONS, SORT_KEY_LABEL,
} from "../lib/members";
import type { AttrIndex, MemberFilter, MemberSort } from "../lib/members";
import { MemberFilterModal } from "../components/master/MemberFilterModal";
import { MemberExtraFields } from "../components/master/MemberExtraFields";
import { WelcomeTab } from "../components/master/WelcomeTab";
import { InlineForm } from "../components/common/InlineForm";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { ProjectFormFields } from "../components/master/ProjectFormFields";
import { AnkenFormFields } from "../components/master/AnkenFormFields";
import { NotifyTab } from "../components/master/NotifyTab";
import { AttributeTab } from "../components/master/AttributeTab";
import { ContentSettingsView } from "../components/content/ContentSettingsView";
import { NewsMaint } from "../components/news/NewsMaint";
import { Icon, IconBadge } from "../components/common/Icon";
import type { IconName } from "../components/common/Icon";
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
  kana: string; tel: string; prefecture: string; createdAt: string;
  source: string; attrIds: number[]; memos: MemberMemo[];
}
interface PendingInvite {
  userId: string; invitedAt: string | null; email: string; name: string; company: string; role: string; chatId: string;
}

// ── 通知（Web Push）状態バッジ ──
function NotifyBadge({ m }: { m: Member }) {
  const st = notifyState(m);
  const n  = m.pushDevices ?? 0;
  const style =
    st === "registered"   ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    st === "off"          ? "bg-gray-100 text-gray-500 border-gray-200" :
                            "bg-yellow-50 text-yellow-700 border-yellow-200";
  const label =
    st === "registered"   ? `通知 登録済（${n}台）` :
    st === "off"          ? `通知OFF（${n}台登録）` :
                            "通知 未登録";
  const title =
    st === "registered"   ? "端末が登録され、通知を受け取れます" :
    st === "off"          ? "端末は登録済みですが、本人が通知を停止中です" :
                            "端末が未登録のため、プッシュ通知を受け取れません";
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border ${style}`}>
      <Icon name={st === "registered" ? "bell" : st === "off" ? "bellOff" : "bellPlus"} size={12} />
      {label}
    </span>
  );
}

// ── 最終ログイン バッジ ──
function LoginBadge({ m }: { m: Member }) {
  const st = loginState(m);
  const style =
    st === "active"  ? "bg-blue-50 text-blue-700 border-blue-200" :
    st === "idle"    ? "bg-amber-50 text-amber-700 border-amber-200" :
    st === "dormant" ? "bg-orange-50 text-orange-700 border-orange-200" :
                       "bg-gray-100 text-gray-500 border-gray-200";
  const label = st === "never" ? "未ログイン" : `最終ログイン ${relDays(m.lastLoginAt)}`;
  return (
    <span title={`${LOGIN_STATE_LABEL[st]}／ログイン ${m.loginCount ?? 0} 回`}
      className={`inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border ${style}`}>
      <Icon name="clock" size={12} />{label}
    </span>
  );
}

// ── コンテンツ視聴 バッジ ──
function ProgressBadge({ p }: { p: { total: number; viewed: number; pct: number } | undefined }) {
  if (!p || p.total === 0) return null;
  const done = p.viewed >= p.total;
  const style = done ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : p.viewed === 0 ? "bg-gray-100 text-gray-500 border-gray-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
  return (
    <span title="属性条件で閲覧できる公開コンテンツに対する視聴済みの割合"
      className={`inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border ${style}`}>
      <Icon name="content" size={12} />視聴 {p.viewed}/{p.total}（{p.pct}%）
    </span>
  );
}

// UAから端末名をざっくり判定（詳細表示用）
function deviceLabel(ua: string): string {
  const s = ua || "";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android";
  if (/Macintosh|Mac OS/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows";
  return "その他の端末";
}
function browserLabel(ua: string): string {
  const s = ua || "";
  if (/Edg\//i.test(s)) return "Edge";
  if (/OPR\//i.test(s)) return "Opera";
  if (/Chrome\//i.test(s)) return "Chrome";
  if (/Firefox\//i.test(s)) return "Firefox";
  if (/Safari\//i.test(s)) return "Safari";
  return "";
}

// ── 利用状況の詳細（編集モーダル内・閲覧専用）──
function EngagementDetail({ m, pages, contents, index, views }: {
  m: Member | undefined; pages: ContentPage[]; contents: CmsContent[];
  index: AttrIndex; views: ReturnType<typeof buildViewIndex>;
}) {
  if (!m) return null;
  const p = memberProgress(m, pages, contents, index, views);
  const list = visibleContentsFor(m, pages, contents, index);
  const seen = views.byMember.get(m.id);
  const pageOf = (id: number) => pages.find((pg) => pg.id === id)?.abbr || pages.find((pg) => pg.id === id)?.name || "";
  const rows = [...list].sort((a, b) => a.pageId - b.pageId || a.sortOrder - b.sortOrder || a.id - b.id);
  return (
    <div className="border border-gray-200 rounded-xl p-3.5 bg-gray-50/60">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5"><Icon name="chart" size={14} /> 利用状況（閲覧専用）</span>
        <LoginBadge m={m} />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 mb-3">
        <span>最終ログイン：<b className="text-gray-800">{fmtDateTime(m.lastLoginAt)}</b>{m.lastLoginAt && <span className="text-gray-400 ml-1">（{relDays(m.lastLoginAt)}）</span>}</span>
        <span>初回ログイン：<b className="text-gray-800">{fmtDateTime(m.firstLoginAt)}</b></span>
        <span>ログイン回数：<b className="text-gray-800">{m.loginCount ?? 0}</b> 回</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-600 shrink-0">コンテンツ視聴</span>
        <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-red-500 rounded-full" style={{ width: `${p.pct}%` }} />
        </div>
        <span className="text-xs font-bold text-gray-700 shrink-0">{p.viewed}/{p.total}（{p.pct}%）</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">このメンバーが閲覧できる公開コンテンツはありません。</p>
      ) : (
        <div className="max-h-52 overflow-y-auto space-y-1">
          {rows.map((c) => {
            const v = seen?.get(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-2 text-xs border rounded-lg px-2.5 py-1.5 ${v ? "bg-white border-gray-200" : "bg-gray-50 border-dashed border-gray-200"}`}>
                <span className={v ? "text-emerald-600 shrink-0" : "text-gray-300 shrink-0"}><Icon name={v ? "check" : "eyeOff"} size={14} /></span>
                <span className="text-[10.5px] text-gray-400 shrink-0">{pageOf(c.pageId)}</span>
                <span className={`truncate ${v ? "text-gray-700" : "text-gray-400"}`}>{c.name}</span>
                <span className="flex-1" />
                {v
                  ? <span className="text-[11px] text-gray-400 shrink-0">{fmtDateTime(v.lastViewedAt)}・{v.viewCount}回</span>
                  : <span className="text-[11px] text-gray-300 shrink-0">未視聴</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 通知状態の詳細（編集モーダル内・閲覧専用）──
function NotifyDetail({ m }: { m: Member | undefined }) {
  if (!m) return null;
  const devices = m.pushDeviceInfo ?? [];
  const st = notifyState(m);
  const onOff = (v: boolean | undefined) =>
    <span className={v === false ? "text-gray-400" : "text-emerald-600 font-semibold"}>{v === false ? "OFF" : "ON"}</span>;
  return (
    <div className="border border-gray-200 rounded-xl p-3.5 bg-gray-50/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5"><Icon name="bell" size={14} /> 通知設定（閲覧専用）</span>
        <NotifyBadge m={m} />
      </div>
      {st === "unregistered" ? (
        <p className="text-xs text-gray-400">端末が登録されていません。本人が「通知設定」画面で端末を登録すると、プッシュ通知が届くようになります。</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 mb-2">
            <span>通知を受け取る：{onOff(m.notifyEnabled)}</span>
            <span>トーク：{onOff(m.notifyChatEnabled)}</span>
            <span>お知らせ：{onOff(m.notifyNewsEnabled)}</span>
          </div>
          <div className="space-y-1">
            {devices.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
                <Icon name={/iPhone|iPad|Android/i.test(d.userAgent) ? "device" : "desktop"} size={14} className="text-gray-400 shrink-0" />
                <span className="font-medium text-gray-700">{deviceLabel(d.userAgent)}</span>
                {browserLabel(d.userAgent) && <span className="text-gray-400">{browserLabel(d.userAgent)}</span>}
                <span className="flex-1" />
                <span className="text-[11px] text-gray-400">{d.createdAt ? d.createdAt.replace("T", " ").slice(0, 16) : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="text-[11px] text-gray-400 mt-2">端末の登録・解除は本人のみ操作できます。</p>
    </div>
  );
}

export function MasterView() {
  const { projects, setProjects, anken, setAnken, members, setMembers, templates, setTemplates, setTasks, permission, perms, setPerms, can } = useMaster();
  const isAdmin = permission.role === "admin";
  const [tab, setTab] = useState<string>("hub");  // "hub"=設定トップ（カード一覧）／各キー=専用画面

  // ── ロール権限マスタ（ロール × 機能 ON/OFF）──
  //   1件でも一括（ジャンル全ON/OFF）でも同じ経路でまとめて反映する
  const changePerms = (changes: PermChange[]) => {
    if (changes.length === 0) return;
    setPerms((p) => {
      const next = { ...p };
      for (const c of changes) next[permKey(c.role, c.feature)] = c.enabled;
      return next;
    });
    for (const c of changes) saveRolePermission(c.role, c.feature, c.enabled);
  };

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
  const [showPermHelp, setShowPermHelp] = useState(false);
  // ── メンバー抽出条件（フィルタ／並び替え）＆属性ツリー ──
  const [memFilter, setMemFilter] = useState<MemberFilter>(DEFAULT_FILTER);
  const [memSort, setMemSort]     = useState<MemberSort>(DEFAULT_SORT);
  const [showMemFilter, setShowMemFilter] = useState(false);
  const [attrTree, setAttrTree]   = useState<AttrNode[]>([]);
  const attrIndex: AttrIndex = useMemo(() => buildAttrIndex(attrTree), [attrTree]);
  useEffect(() => { loadAttributeTree().then(setAttrTree).catch(() => setAttrTree([])); }, []);
  // ── 利用状況（コンテンツ視聴ログ）──
  const [cPages, setCPages]       = useState<ContentPage[]>([]);
  const [cContents, setCContents] = useState<CmsContent[]>([]);
  const [viewRows, setViewRows]   = useState<ContentViewRow[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const [{ pages, contents }, rows] = await Promise.all([fetchContentData(), fetchContentViews()]);
        setCPages(pages); setCContents(contents); setViewRows(rows);
      } catch (e) { console.warn("コンテンツ視聴状況の読込エラー:", e); }
    })();
  }, []);
  const viewIndex = useMemo(() => buildViewIndex(viewRows), [viewRows]);
  const progressMap = useMemo(
    () => buildProgressMap(members, cPages, cContents, attrIndex, viewIndex),
    [members, cPages, cContents, attrIndex, viewIndex],
  );
  // 流入経路の候補（初回メッセージ設定で管理）
  const [welcomeRoutes, setWelcomeRoutes] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => { loadAppSettings().then((s) => setWelcomeRoutes(s.welcomeRoutes.map((r) => ({ key: r.key, label: r.label })))).catch(() => setWelcomeRoutes([])); }, []);
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
    setEditMember({ id: m.id, old: m.name, name: m.name, role: m.role, email: m.email ?? "", company: m.company ?? "", chatId: m.chatId ?? "", userId: m.userId,
      kana: m.kana ?? "", tel: m.tel ?? "", prefecture: m.prefecture ?? "", createdAt: m.createdAt ?? "", source: m.source ?? "",
      attrIds: [...(m.attrIds ?? [])], memos: (m.memos ?? []).map((mo) => ({ ...mo })) });
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
    setEditMember({ id: null, old: null, name: "", role: "メンバー", email: "", company: "", chatId: "", userId: null,
      kana: "", tel: "", prefecture: "", createdAt: "", source: "", attrIds: [], memos: [] });
  };
  const inviteFromModal = async () => {
    if (!editMember) return;
    const name = (editMember.name || "").trim();
    const email = (editMember.email || "").trim();
    if (!name || !email) { setAcctMsg({ ok: false, text: "招待には表示名とメールアドレスが必要です" }); return; }
    setMemberLinking(true); setAcctMsg(null);
    try {
      const res = await apiFetch("/api/invite", {
        method: "POST",
        body: { email, name, role: editMember.role, company: (editMember.company || "").trim(), chatId: (editMember.chatId || "").trim(), memberId: editMember.id, source: (editMember.source || "").trim() || null },
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
  // 招待・付与できるロール:
  //   管理者 → オペレーター / メンバー / 外部（管理者は付与不可）
  //   オペレーター → メンバー / 外部
  const assignableRoles = myRole === "admin" ? MEMBER_ROLES.filter((r) => r !== "管理者")
    : myRole === "leader" ? MEMBER_ROLES.filter((r) => r !== "管理者" && r !== "オペレーター")
    : [];
  // 編集・招待できる対象メンバー:
  //   管理者 → 管理者以外（オペレーター/メンバー/外部）
  //   オペレーター → メンバー / 外部
  const canEditMember = (m: Member) =>
    myRole === "admin" ? m.role !== "管理者"
    : myRole === "leader" ? (m.role === "メンバー" || m.role === "外部")
    : false;
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
      const res  = await apiFetch("/api/invite", { method: "GET" });
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
      const res  = await apiFetch("/api/invite", { method: "DELETE", body: { userId } });
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
      const res  = await apiFetch("/api/invite", { method: "POST", body: { email, name, role: memberRole, company, chatId, memberId: inviteMemberId } });
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
    const emailTrim = (editMember.email ?? "").trim();
    // メール重複チェック（自分以外）
    if (emailTrim) {
      const dup = members.some((m) => !m.isDeleted && m.id !== editMember.id
        && (m.email ?? "").trim().toLowerCase() === emailTrim.toLowerCase());
      if (dup) { setAcctMsg({ ok: false, text: "このメールアドレスは既に登録されています" }); return; }
    }
    setMemberLinking(true);
    const newName  = editMember.name.trim();
    const userId   = await fetchUserIdByEmail(emailTrim);
    const extra = {
      kana: editMember.kana?.trim() || null,
      tel: editMember.tel?.trim() || null,
      prefecture: editMember.prefecture || null,
    };
    const updates: TablesInsert<"members"> = { name: newName, role: editMember.role as Role, email: emailTrim || null, user_id: userId, company: editMember.company?.trim() || null, chat_id: editMember.chatId?.trim() || null, source: editMember.source?.trim() || null, ...extra };
    const localExtra = {
      kana: editMember.kana?.trim() || "", tel: editMember.tel?.trim() || "",
      prefecture: editMember.prefecture || "", source: editMember.source?.trim() || "",
      attrIds: editMember.attrIds, memos: editMember.memos,
    };
    if (editMember.id == null && !editMember.old) {
      const { data, error } = await supabase.from("members").insert(updates).select().single();
      if (!error && data) {
        await saveMemberExtras(data.id, editMember.attrIds, editMember.memos);
        setMembers((prev) => [...prev, { id: data.id, name: newName, role: editMember.role as Role, email: updates.email ?? "", userId, company: editMember.company?.trim() || "", chatId: editMember.chatId?.trim() || "", isDeleted: false, createdAt: data.created_at ?? "", ...localExtra }]);
      }
      setMemberLinking(false);
      setEditMember(null);
      return;
    }
    const q = editMember.id != null
      ? supabase.from("members").update(updates).eq("id", editMember.id)
      : supabase.from("members").update(updates).eq("name", editMember.old!);
    const { error } = await q;
    if (!error && editMember.id != null) await saveMemberExtras(editMember.id, editMember.attrIds, editMember.memos);
    setMemberLinking(false);
    if (!error) setMembers((prev) => prev.map((m) =>
      (editMember.id != null ? m.id === editMember.id : m.name === editMember.old)
        ? { ...m, name: newName, role: editMember.role as Role, email: updates.email ?? "", userId, company: editMember.company?.trim() || "", chatId: editMember.chatId?.trim() || "", ...localExtra } : m
    ));
    setEditMember(null);
  };

  const deleteMember = async (id: number) => {
    const { error } = await supabase.from("members").update({ is_deleted: true }).eq("id", id);
    if (!error) setMembers((prev) => prev.map((m) => m.id === id ? { ...m, isDeleted: true } : m));
    setMemberConfirm(null);
    setEditMember(null);
  };

  // 設定ハブ：ジャンル別グループ（仕切り付き）
  type Section = { key: string; label: string; desc: string; icon: IconName; adminOnly?: boolean };
  const SECTION_GROUPS: { label: string; items: Section[] }[] = [
    { label: "プロジェクト管理", items: [
      { key: "project",  label: "プロジェクト", desc: "プロジェクトの追加・編集", icon: "folder" },
      { key: "anken",    label: "分類（案件）", desc: "フェーズ・工程の管理",    icon: "layers" },
      { key: "template", label: "テンプレート", desc: "ひな形の管理",            icon: "template" },
    ]},
    { label: "メンバー・権限", items: [
      { key: "permission", label: "権限",     desc: "ロール×機能の表示/利用可否", icon: "shield", adminOnly: true },
      { key: "member",     label: "メンバー", desc: "メンバーマスタ・権限・招待",  icon: "users" },
      { key: "attribute",  label: "属性",     desc: "属性A▷B▷Cの階層設定",       icon: "tags" },
    ]},
    { label: "コンテンツ・お知らせ", items: [
      { key: "content", label: "コンテンツ", desc: "コンテンツの掲載・編集",     icon: "content" },
      { key: "news",    label: "お知らせ",   desc: "ホーム掲載のお知らせを管理",  icon: "news" },
    ]},
    { label: "チャット", items: [
      { key: "welcome", label: "初回メッセージ", desc: "初回ログイン時のウェルカム文面・流入経路分岐", icon: "chat" },
    ]},
  ];
  const ALL_SECTIONS = SECTION_GROUPS.flatMap((g) => g.items);
  const curSection = ALL_SECTIONS.find((s) => s.key === tab) ?? null;

  return (
    <div className="space-y-4">
      {tab === "hub" ? (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-extrabold text-gray-800">設定</h1>
            <p className="text-xs text-gray-400 mt-1">各マスタ・機能の管理画面へ移動します。</p>
          </div>
          {SECTION_GROUPS.map((g) => {
            const cards = g.items.filter((s) => !s.adminOnly || isAdmin);
            if (cards.length === 0) return null;
            return (
              <div key={g.label}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-xs font-bold text-gray-500 tracking-wide whitespace-nowrap">{g.label}</h2>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
                  {cards.map((s) => (
                    <button key={s.key} onClick={() => setTab(s.key)}
                      className="text-left bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-gray-300 transition-all">
                      <div className="flex items-center gap-3 mb-1.5">
                        <IconBadge name={s.icon} />
                        <span className="text-[15px] font-bold text-gray-800">{s.label}</span>
                      </div>
                      <p className="text-xs text-gray-400 m-0">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <button onClick={() => setTab("hub")}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">
          ← 設定{curSection ? `　/　${curSection.label}` : ""}
        </button>
      )}

      {tab === "content" && <ContentSettingsView />}

      {tab === "news" && <NewsMaint />}

      {tab === "welcome" && <WelcomeTab />}

      {tab === "permission" && isAdmin && (
        <PermissionTab perms={perms} onChange={changePerms} />
      )}

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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => setShowMemFilter(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">
                🔎 抽出条件
                {activeFilterCount(memFilter, memSort) > 0 &&
                  <span className="bg-red-600 text-white rounded-full text-[10px] px-1.5">{activeFilterCount(memFilter, memSort)}</span>}
              </button>
              {activeFilterCount(memFilter, memSort) > 0 &&
                <button type="button" onClick={() => { setMemFilter(DEFAULT_FILTER); setMemSort(DEFAULT_SORT); }}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">条件クリア</button>}
              <button type="button" onClick={openPending} className="text-sm text-red-600 hover:text-red-800 underline whitespace-nowrap">招待中の一覧</button>
              <button type="button" onClick={() => setShowPermHelp(true)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 whitespace-nowrap">🛈 権限早見表</button>
            </div>
            <button onClick={openMemberAdd} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 shrink-0">＋ 追加</button>
          </div>

          {/* 適用中の抽出条件チップ */}
          {activeFilterCount(memFilter, memSort) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {memFilter.keyword.trim() && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">キーワード：<b className="text-gray-800">{memFilter.keyword}</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, keyword: "" }))}>×</span></span>)}
              {memFilter.tags.length > 0 && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">属性（{ATTR_MODE_LABEL[memFilter.attrMode]}）：<b className="text-gray-800">{memFilter.tags.map((t) => attrLabel(attrIndex, t)).join(" ／ ")}</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, tags: [] }))}>×</span></span>)}
              {memFilter.unlinkedOnly && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">状態：<b className="text-gray-800">紐づけ未済</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, unlinkedOnly: false }))}>×</span></span>)}
              {memFilter.notify !== "all" && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">通知設定：<b className="text-gray-800">{NOTIFY_FILTER_OPTIONS.find((o) => o.value === memFilter.notify)?.label}</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, notify: "all" }))}>×</span></span>)}
              {memFilter.login !== "all" && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">最終ログイン：<b className="text-gray-800">{LOGIN_FILTER_OPTIONS.find((o) => o.value === memFilter.login)?.label}</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, login: "all" }))}>×</span></span>)}
              {memFilter.progress !== "all" && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">コンテンツ視聴：<b className="text-gray-800">{PROGRESS_FILTER_OPTIONS.find((o) => o.value === memFilter.progress)?.label}</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemFilter((f) => ({ ...f, progress: "all" }))}>×</span></span>)}
              {!isDefaultSort(memSort) && (
                <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full text-[11.5px] px-2.5 py-1 text-gray-600">並び替え：<b className="text-gray-800">{SORT_KEY_LABEL[memSort.key]}（{memSort.dir === "asc" ? "昇順" : "降順"}）</b>
                  <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => setMemSort(DEFAULT_SORT)}>×</span></span>)}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {(() => {
              const activeMembers = members.filter((m) => !m.isDeleted);
              const filteredMembers = sortMembers(filterMembers(members, memFilter, attrIndex, progressMap), memSort, progressMap);
              return (<>
            <div className="px-4 pt-3 pb-1 text-xs text-gray-400">{filteredMembers.length} 名 / 全 {activeMembers.length} 名</div>
            {activeMembers.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">メンバーがいません</div>}
            {activeMembers.length > 0 && filteredMembers.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">該当するメンバーがいません</div>}
            {filteredMembers.map((m, i) => (
              <div key={m.id} className={`px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">{m.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{m.name}{m.kana && <span className="text-[11px] text-gray-400 ml-1.5">{m.kana}</span>}</p>
                    <p className="text-xs text-gray-400 truncate flex flex-wrap gap-x-3">
                      {m.email
                        ? <span>✉ {m.email}<span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${m.userId ? "bg-green-50 text-green-600" : "bg-yellow-50 text-yellow-700"}`}>{m.userId ? "紐づけ済" : "未紐づけ"}</span></span>
                        : <span className="text-gray-300">メール未設定</span>}
                      {m.tel && <span>☎ {m.tel}</span>}
                      {m.prefecture && <span>📍 {m.prefecture}</span>}
                      {(m.memos?.length ?? 0) > 0 && <span>📝 メモ {m.memos!.length}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <NotifyBadge m={m} />
                      <LoginBadge m={m} />
                      <ProgressBadge p={progressMap.get(m.id)} />
                    </div>
                    {(m.attrIds?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {m.attrIds!.map((id) => {
                          const segs = attrSegs(attrIndex, id);
                          const last = segs[segs.length - 1] ?? { color: "#9ca3af" };
                          return <span key={id} className="text-[10.5px] px-2 py-0.5 rounded-full border"
                            style={{ borderColor: `${last.color}55`, color: last.color, background: `${last.color}0f` }}>{attrLabel(attrIndex, id)}</span>;
                        })}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                    m.role === "管理者" ? "bg-red-50 text-red-600 border-red-200" :
                    m.role === "オペレーター" ? "bg-blue-50 text-red-600 border-red-200" :
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

      {tab === "attribute" && <AttributeTab />}

      {tab === "notify" && <NotifyTab />}

      {showMemFilter && (
        <MemberFilterModal tree={attrTree} index={attrIndex} filter={memFilter} sort={memSort}
          onApply={(f, s) => { setMemFilter(f); setMemSort(s); }}
          onClear={() => { setMemFilter(DEFAULT_FILTER); setMemSort(DEFAULT_SORT); }}
          onClose={() => setShowMemFilter(false)} />
      )}

      {editMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditMember(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{editMember.id == null && !editMember.old ? "メンバーを追加" : "メンバーを編集"}</h2>
              <button onClick={() => setEditMember(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              {/* 氏名 ＋ 氏名カナ */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">氏名 <span className="text-red-500">*</span></label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.name} onChange={(e) => setEditMember((v) => v ? { ...v, name: e.target.value } : v)} autoFocus placeholder="氏名 *" />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">氏名カナ</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.kana} onChange={(e) => setEditMember((v) => v ? { ...v, kana: e.target.value } : v)} placeholder="セイ メイ" />
                </div>
              </div>

              {/* メールアドレス ＋ 電話番号 */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">メールアドレス <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">重複禁止</span></label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    type="email" value={editMember.email ?? ""} onChange={(e) => setEditMember((v) => v ? { ...v, email: e.target.value } : v)}
                    placeholder="メールアドレス（Supabaseアカウントと紐づけ）" />
                </div>
                <div className="w-40">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">電話番号</label>
                  <input type="tel" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                    value={editMember.tel} onChange={(e) => setEditMember((v) => v ? { ...v, tel: e.target.value } : v)} placeholder="090-0000-0000" />
                </div>
              </div>
              {editMember.email?.trim() && <p className="text-xs text-gray-400 -mt-1.5">保存時に Supabase アカウントと紐づけます。</p>}

              {/* 権限（付与可能ロールのみ選択）＋ 登録日時（自動） */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">権限</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400"
                    value={editMember.role} onChange={(e) => setEditMember((v) => v ? { ...v, role: e.target.value } : v)}>
                    {((assignableRoles as string[]).includes(editMember.role) ? (assignableRoles as string[]) : [editMember.role, ...(assignableRoles as string[])])
                      .map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">登録日時 <span className="text-gray-400 font-normal">自動更新</span></label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                    value={editMember.createdAt ? editMember.createdAt.replace("T", " ").slice(0, 16) : new Date().toISOString().slice(0, 16).replace("T", " ")} readOnly />
                </div>
              </div>

              <MemberExtraFields
                tree={attrTree} index={attrIndex}
                prefecture={editMember.prefecture} onPref={(v) => setEditMember((s) => s ? { ...s, prefecture: v } : s)}
                attrIds={editMember.attrIds} onAttrIds={(ids) => setEditMember((s) => s ? { ...s, attrIds: ids } : s)}
                memos={editMember.memos} onMemos={(mm) => setEditMember((s) => s ? { ...s, memos: mm } : s)}
              />

              {/* 利用状況：最終ログインとコンテンツ視聴（閲覧専用）*/}
              {editMember.id != null && (
                <EngagementDetail
                  m={members.find((mm) => mm.id === editMember.id)}
                  pages={cPages} contents={cContents} index={attrIndex} views={viewIndex}
                />
              )}

              {/* 通知（Web Push）の状態：本人が登録した端末とON/OFFを表示（閲覧専用）*/}
              {editMember.id != null && <NotifyDetail m={members.find((mm) => mm.id === editMember.id)} />}

              {/* 流入経路（初回メッセージの分岐に使用。招待時に付与）*/}
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">流入経路 <span className="text-gray-400 font-normal">初回メッセージの分岐に使用</span></label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400"
                  value={editMember.source} onChange={(e) => setEditMember((v) => v ? { ...v, source: e.target.value } : v)}>
                  <option value="">（未設定：既定メッセージ）</option>
                  {editMember.source && !welcomeRoutes.some((r) => r.key === editMember.source) && (
                    <option value={editMember.source}>{editMember.source}（未登録）</option>
                  )}
                  {welcomeRoutes.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {welcomeRoutes.length === 0 && <p className="text-[11px] text-gray-400 mt-1">経路は「設定 ＞ 初回メッセージ」で追加できます。</p>}
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
                    <th className="py-2 px-1"><span className="bg-blue-50 text-red-700 rounded-full px-2 py-0.5">オペレーター</span></th>
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
                招待で付与できるロール：管理者＝全ロール／オペレーター＝オペレーター以下。権限はクライアント・サーバ双方で検証します。
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
                                p.role === "オペレーター" ? "bg-blue-50 text-red-600 border-red-200" :
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
