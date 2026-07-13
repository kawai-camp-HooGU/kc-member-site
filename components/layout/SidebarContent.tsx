"use client";
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
  onSelect: (k: string) => void;
  permission: Permission;
  user: User | null;
  userInitial: string;
  onSignOut: () => void;
  onNavigate?: () => void;
  chatUnread?: number;
  /** 入り口（Phase 2）。"ops" のときだけ運営メニュー（Admin グループ）を出す。 */
  zone?: Zone;
}

interface NavItem { key: string; label: string; jp: string; icon: IconName; feature?: string }
interface NavGroup { id: string; label: string; items: NavItem[] }

// トップ（グループ外・最上部）
const TOP: NavItem[] = [
  { key: "home", label: "Home", jp: "ホーム", icon: "home", feature: "home" },
];
// ジャンル別グループ（英語ベース）。feature=ロール権限マスタのキー（未指定は常時表示）
const GROUPS: NavGroup[] = [
  { id: "content", label: "Content", items: [
    { key: "content", label: "Content", jp: "コンテンツ", icon: "content", feature: "content" },
  ]},
  { id: "community", label: "Community", items: [
    // カレンダーはイベント・フォーム締切を含む「コミュニティの予定表」なのでここに置く
    { key: "calendar", label: "Calendar", jp: "カレンダー", icon: "calendar", feature: "calendar" },
    { key: "chat", label: "Chat", jp: "チャット", icon: "chat", feature: "chat" },
  ]},
  { id: "notification", label: "Notification", items: [
    { key: "notification", label: "Notifications", jp: "通知設定", icon: "bell", feature: "notification" },
  ]},
  { id: "roadmap", label: "Roadmap", items: [
    { key: "dashboard", label: "Dashboard", jp: "ダッシュボード", icon: "dashboard", feature: "dashboard" },
    { key: "kanban",    label: "Board",     jp: "カンバン",       icon: "board",     feature: "kanban" },
    { key: "gantt",     label: "Timeline",  jp: "ガント",         icon: "timeline",  feature: "gantt" },
    { key: "bulkadd",   label: "Bulk Add",  jp: "一括登録",       icon: "bulk",      feature: "bulk_register" },
  ]},
  { id: "admin", label: "Admin", items: [
    { key: "broadcast", label: "Broadcast", jp: "一斉配信",   icon: "broadcast", feature: "broadcast" },
    { key: "scenario",  label: "Scenario",  jp: "シナリオ配信", icon: "scenario",  feature: "scenario" },
    { key: "form",      label: "Form",      jp: "フォーム",    icon: "form",      feature: "form" },
    { key: "master",    label: "Settings",  jp: "設定",      icon: "settings",  feature: "master" },
  ]},
];
const HELP: NavItem = { key: "help", label: "Help", jp: "ヘルプ", icon: "help", feature: "help" };

// サイドバー／ドロワー共通の中身
export function SidebarContent({ view, onSelect, permission, user, userInitial, onSignOut, onNavigate, chatUnread = 0, zone = "member" }: SidebarContentProps) {
  const { can } = useMaster();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpsZone = zone === "ops";
  const go = (k: string) => { onSelect(k); onNavigate && onNavigate(); };
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // ロール権限（can）に加えて、ゾーン外の運営メニューは出さない（Phase 2）
  const visible = (it: NavItem) =>
    (!it.feature || can(it.feature)) && (isOpsZone || !isOpsView(it.key));
  // 運営ロールなら、もう一方のゾーンへの導線を出す（会員体験の確認／運営コンソールへの復帰）
  const showZoneSwitch = isOpsRole(permission.roleLabel);

  const Item = ({ it }: { it: NavItem }) => {
    const active = view === it.key;
    const badge = it.key === "chat" && chatUnread > 0 ? chatUnread : 0;
    return (
      <button onClick={() => go(it.key)}
        className={`w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
        <span className="w-[18px] flex items-center justify-center shrink-0 opacity-90"><Icon name={it.icon} size={18} /></span>
        <span className="flex-1 text-left">{it.label}</span>
        {badge > 0 && (
          <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none ${active ? "bg-white text-red-600" : "bg-red-500 text-white"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        <span className={`text-[10px] ${active ? "text-white/70" : "text-slate-500"}`}>{it.jp}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <LogoMark box="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight leading-none">
          <span className="text-white tracking-wide">KAWAI</span><span className="text-white tracking-wide"> CAMP</span>
          {isOpsZone && <span className="text-red-500 tracking-wide"> OPS</span>}
        </span>
      </div>
      {isOpsZone && (
        <div className="mx-3 mb-2 rounded-md bg-red-600/15 border border-red-600/40 px-2.5 py-1.5 text-[10px] font-bold text-red-300 tracking-wide">
          運営管理コンソール
        </div>
      )}

      <div className="px-2">
        {TOP.filter(visible).map((it) => <Item key={it.key} it={it} />)}
      </div>

      <nav className="flex-1 px-2 mt-1 space-y-1 overflow-y-auto">
        {GROUPS.map((g) => {
          const items = g.items.filter(visible);
          if (items.length === 0) return null;
          const isCol = !!collapsed[g.id];
          return (
            <div key={g.id}>
              <button onClick={() => toggle(g.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-extrabold tracking-wider uppercase text-slate-500 hover:text-slate-400">
                <span>{g.label}</span>
                <span className={`ml-auto text-[9px] transition-transform ${isCol ? "-rotate-90" : ""}`}>▼</span>
              </button>
              {!isCol && <div className="space-y-0.5">{items.map((it) => <Item key={it.key} it={it} />)}</div>}
            </div>
          );
        })}
      </nav>

      {visible(HELP) && (
        <div className="px-2 pb-1">
          <Item it={HELP} />
        </div>
      )}

      {/* ゾーン切替（運営ロールのみ）。会員体験の確認 ⇔ 運営コンソール */}
      {showZoneSwitch && (
        <div className="px-2 pb-1">
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

      <div className="px-3 py-3 border-t border-neutral-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm shrink-0">{userInitial}</div>
          <span className="text-xs text-slate-300 truncate flex-1">{user?.email}</span>
        </div>
        <button onClick={onSignOut} className="w-full text-xs text-slate-400 hover:text-white border border-neutral-700 rounded-lg py-1.5 transition-colors">Log out</button>
      </div>
    </div>
  );
}
