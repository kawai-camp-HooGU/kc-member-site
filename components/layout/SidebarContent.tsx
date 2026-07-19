"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Permission } from "../../hooks/usePermission";
import { useMaster } from "../../hooks/useMaster";
import { LogoMark } from "./LogoMark";
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import type { Zone } from "../../lib/zone";
import { isOpsView, isOpsRole, OPS_ROOT, MEMBER_ROOT } from "../../lib/zone";

export interface SidebarContentProps {
  view: string;
  /** 現在の view より後ろのパスセグメント先頭（例：/ops/master/news → "news"）。設定内タブのハイライト用。 */
  subview?: string;
  onSelect: (k: string) => void;
  permission: Permission;
  user: User | null;
  userInitial: string;
  onSignOut: () => void;
  onNavigate?: () => void;
  chatUnread?: number;
  /** 入り口（Phase 2）。"ops" のときだけ運営メニューを出す。 */
  zone?: Zone;
}

//   href … 設定内のマスタ画面（/ops/master/{tab}）へのリンク。指定時は view 遷移でなく直接 push。
interface NavItem { key: string; label: string; jp: string; icon: IconName; feature?: string; href?: string }
interface NavGroup { id: string; label: string; items: NavItem[] }

// 設定ハブから「サイドバーへ昇格」したタブ。これらに居るときは設定(master)を非アクティブにする。
const PROMOTED_TABS = new Set<string>(["member", "content", "source", "news", "event", "welcome"]);

// ── トップ（グループ外・最上部） ──
const TOP: NavItem[] = [
  { key: "home", label: "Home", jp: "ホーム", icon: "home", feature: "home" },
];

// ── 会員メニュー（案1）：コミュニティ → ロードマップ → その他 ──
const MEMBER_GROUPS: NavGroup[] = [
  { id: "community", label: "Community", items: [
    { key: "content",  label: "Content",  jp: "コンテンツ", icon: "content",  feature: "content" },
    { key: "calendar", label: "Calendar", jp: "カレンダー", icon: "calendar", feature: "calendar" },
    { key: "chat",     label: "Chat",     jp: "チャット",   icon: "chat",     feature: "chat" },
  ]},
  { id: "roadmap", label: "Roadmap", items: [
    { key: "dashboard", label: "Dashboard", jp: "ダッシュボード", icon: "dashboard", feature: "dashboard" },
    { key: "kanban",    label: "Board",     jp: "カンバン",       icon: "board",     feature: "kanban" },
    { key: "gantt",     label: "Timeline",  jp: "ガント",         icon: "timeline",  feature: "gantt" },
    { key: "bulkadd",   label: "Bulk Add",  jp: "一括登録",       icon: "bulk",      feature: "bulk_register" },
  ]},
  { id: "other", label: "Other", items: [
    { key: "notification", label: "Notifications", jp: "通知設定", icon: "bell", feature: "notification" },
    { key: "help",         label: "Help",          jp: "ヘルプ",   icon: "help", feature: "help" },
  ]},
];

// ── 運営メニュー（案2フロー順）：集客 → 配信 → 顧客 → 決済 → コミュニティ管理 → 設定 ──
//   href 付き（流入経路・初回メッセージ・お知らせ・イベント・メンバー）は設定内マスタタブへのリンク。
const OPS_GROUPS: NavGroup[] = [
  { id: "acq", label: "Acquisition", items: [
    { key: "form",   label: "Form",   jp: "フォーム",   icon: "form",  feature: "form" },
    { key: "source", label: "Source", jp: "流入経路",   icon: "globe", feature: "set_source", href: "/ops/master/source" },
  ]},
  { id: "delivery", label: "Delivery", items: [
    { key: "broadcast", label: "Broadcast", jp: "一斉配信",     icon: "broadcast", feature: "broadcast" },
    { key: "scenario",  label: "Scenario",  jp: "シナリオ配信", icon: "scenario",  feature: "scenario" },
    { key: "welcome",   label: "Welcome",   jp: "初回メッセージ", icon: "chat",    feature: "set_welcome", href: "/ops/master/welcome" },
  ]},
  { id: "customer", label: "Customer", items: [
    { key: "member", label: "Member", jp: "メンバー", icon: "users", feature: "set_member", href: "/ops/master/member" },
  ]},
  { id: "payment", label: "Payment", items: [
    { key: "payments", label: "Payments", jp: "決済", icon: "doc", feature: "payment_manage" },
  ]},
  { id: "commmgmt", label: "Community Mgmt", items: [
    { key: "contentset", label: "Content",   jp: "コンテンツ管理",   icon: "content",  feature: "content_manage" },
    { key: "news",       label: "News",      jp: "お知らせ",         icon: "news",     feature: "set_news",   href: "/ops/master/news" },
    { key: "event",      label: "Events",    jp: "イベント・予定",   icon: "calendar", feature: "event_manage", href: "/ops/master/event" },
    // ⚠️ 以前は feature: "chat" を流用していたため、チャットをOFFにすると
    //    ブックマークも巻き添えで消えていた。専用キーに分離済み。
    { key: "bookmarks",  label: "Bookmarks", jp: "ブックマーク",     icon: "book",     feature: "bookmarks" },
  ]},
  { id: "settings", label: "Settings", items: [
    { key: "master", label: "Settings", jp: "設定", icon: "settings", feature: "master" },
  ]},
];

// サイドバー／ドロワー共通の中身
export function SidebarContent({ view, subview = "", onSelect, permission, user, userInitial, onSignOut, onNavigate, chatUnread = 0, zone = "member" }: SidebarContentProps) {
  const { can } = useMaster();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpsZone = zone === "ops";
  const go = (k: string) => { onSelect(k); onNavigate && onNavigate(); };
  const goHref = (href: string) => { router.push(href); onNavigate && onNavigate(); };
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // ロール権限（can）に加えて、ゾーン外の運営メニューは出さない（Phase 2）
  const visible = (it: NavItem) =>
    (!it.feature || can(it.feature)) && (isOpsZone || !isOpsView(it.key));
  // 運営ロールなら、もう一方のゾーンへの導線を出す（会員体験の確認／運営コンソールへの復帰）
  const showZoneSwitch = isOpsRole(permission.roleLabel);

  // ops=true の行は案5の運営専用マーク（赤アイコン＋右端の赤ドット）を付ける。
  const Item = ({ it, ops = false }: { it: NavItem; ops?: boolean }) => {
    const active =
      it.href        ? (view === "master" && subview === it.key)
      : it.key === "master" ? (view === "master" && !PROMOTED_TABS.has(subview))
      : view === it.key;
    const badge = it.key === "chat" && chatUnread > 0 ? chatUnread : 0;
    return (
      <button onClick={() => (it.href ? goHref(it.href) : go(it.key))}
        className={`w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
        <span className={`w-[18px] flex items-center justify-center shrink-0 ${active ? "opacity-90" : ops ? "text-red-400" : "opacity-90"}`}><Icon name={it.icon} size={18} /></span>
        <span className="flex-1 text-left">{it.label}</span>
        {badge > 0 && (
          <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none ${active ? "bg-white text-red-600" : "bg-red-500 text-white"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        <span className={`text-[10px] ${active ? "text-white/70" : "text-slate-500"}`}>{it.jp}</span>
        {ops && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-white/80" : "bg-red-500"}`} />}
      </button>
    );
  };

  const Group = ({ g, ops }: { g: NavGroup; ops: boolean }) => {
    const items = g.items.filter(visible);
    if (items.length === 0) return null;
    const isCol = !!collapsed[g.id];
    return (
      <div>
        <button onClick={() => toggle(g.id)}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-extrabold tracking-wider uppercase text-slate-500 hover:text-slate-400">
          <span>{g.label}</span>
          <span className={`ml-auto text-[9px] transition-transform ${isCol ? "-rotate-90" : ""}`}>▼</span>
        </button>
        {!isCol && <div className="space-y-0.5">{items.map((it) => <Item key={it.key} it={it} ops={ops} />)}</div>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── 固定：ロゴ ── */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-4">
        <LogoMark box="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight leading-none">
          <span className="text-white tracking-wide">KAWAI</span><span className="text-white tracking-wide"> CAMP</span>
          {isOpsZone && <span className="text-red-500 tracking-wide"> OPS</span>}
        </span>
      </div>

      {/* ── スクロール：メニュー全体 ── */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">

        {/* 会員ゾーン（運営コンソールでは「会員メニュー」帯で明示） */}
        {isOpsZone && (
          <div className="mx-3 mt-1 mb-1 px-2.5 py-1 rounded-md bg-white/5 text-[10px] font-bold tracking-wide text-slate-400">会員メニュー</div>
        )}
        <div className="px-2">
          {TOP.filter(visible).map((it) => <Item key={it.key} it={it} />)}
        </div>
        <nav className="px-2 mt-1 space-y-1">
          {MEMBER_GROUPS.map((g) => <Group key={g.id} g={g} ops={false} />)}
        </nav>

        {/* 運営ゾーン（運営専用。赤マークで会員と区別） */}
        {isOpsZone && (
          <>
            <div className="mx-3 mt-3 mb-1 px-2.5 py-1 rounded-md bg-red-500/10 text-[10px] font-bold tracking-wide text-red-300">運営専用</div>
            <nav className="px-2 space-y-1">
              {OPS_GROUPS.map((g) => <Group key={g.id} g={g} ops={true} />)}
            </nav>
          </>
        )}

        {/* ゾーン切替（運営ロールのみ）。会員体験の確認 ⇔ 運営コンソール */}
        {showZoneSwitch && (
          <div className="px-2 pt-2 pb-2">
            <a href={isOpsZone ? MEMBER_ROOT : OPS_ROOT}
              className="w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-neutral-800 hover:text-white transition-colors">
              <span className="w-[18px] flex items-center justify-center shrink-0 opacity-90">
                <Icon name={isOpsZone ? "home" : "settings"} size={18} />
              </span>
              <span className="flex-1 text-left">{isOpsZone ? "Member View" : "OPS Console"}</span>
              <span className="text-[10px] text-slate-500">{isOpsZone ? "会員画面" : "運営"}</span>
            </a>
          </div>
        )}
      </div>

      {/* ── 固定：ログインアカウント ── */}
      <div className="shrink-0 px-3 py-3 border-t border-neutral-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm shrink-0">{userInitial}</div>
          <span className="text-xs text-slate-300 truncate flex-1">{user?.email}</span>
        </div>
        <button onClick={onSignOut} className="w-full text-xs text-slate-400 hover:text-white border border-neutral-700 rounded-lg py-1.5 transition-colors">Log out</button>
      </div>
    </div>
  );
}
