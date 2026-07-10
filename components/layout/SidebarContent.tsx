"use client";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Permission } from "../../hooks/usePermission";
import { useMaster } from "../../hooks/useMaster";
import { LogoMark } from "./LogoMark";

export interface SidebarContentProps {
  view: string;
  onSelect: (k: string) => void;
  permission: Permission;
  user: User | null;
  userInitial: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}

interface NavItem { key: string; label: string; jp: string; icon: string; feature?: string }
interface NavGroup { id: string; label: string; items: NavItem[] }

// トップ（グループ外・最上部）
const TOP: NavItem[] = [
  { key: "home", label: "Home", jp: "ホーム", icon: "⌂" },
];
// ジャンル別グループ（英語ベース）。feature=ロール権限マスタのキー（未指定は常時表示）
const GROUPS: NavGroup[] = [
  { id: "roadmap", label: "Roadmap", items: [
    { key: "dashboard", label: "Dashboard", jp: "ダッシュボード", icon: "▤", feature: "dashboard" },
    { key: "kanban",    label: "Board",     jp: "カンバン",       icon: "▦", feature: "kanban" },
    { key: "gantt",     label: "Timeline",  jp: "ガント",         icon: "≡", feature: "gantt" },
    { key: "calendar",  label: "Calendar",  jp: "カレンダー",     icon: "▧", feature: "calendar" },
    { key: "bulkadd",   label: "Bulk Add",  jp: "一括登録",       icon: "＋", feature: "bulk_register" },
  ]},
  { id: "content", label: "Content", items: [
    { key: "content", label: "Content", jp: "コンテンツ", icon: "▷", feature: "content" },
  ]},
  { id: "community", label: "Community", items: [
    { key: "chat", label: "Chat", jp: "チャット", icon: "💬", feature: "chat" },
  ]},
  { id: "admin", label: "Admin", items: [
    { key: "contentset", label: "Content Settings", jp: "コンテンツ設定", icon: "▤", feature: "content_manage" },
    { key: "master",     label: "Settings",         jp: "設定",           icon: "⚙", feature: "master" },
  ]},
];
const HELP: NavItem = { key: "help", label: "Help", jp: "ヘルプ", icon: "?" };

// サイドバー／ドロワー共通の中身
export function SidebarContent({ view, onSelect, user, userInitial, onSignOut, onNavigate }: SidebarContentProps) {
  const { can } = useMaster();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const go = (k: string) => { onSelect(k); onNavigate && onNavigate(); };
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const visible = (it: NavItem) => !it.feature || can(it.feature);

  const Item = ({ it }: { it: NavItem }) => (
    <button onClick={() => go(it.key)}
      className={`w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === it.key ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
      <span className="w-[18px] text-center text-[13px] opacity-90">{it.icon}</span>
      <span className="flex-1 text-left">{it.label}</span>
      <span className={`text-[10px] ${view === it.key ? "text-white/70" : "text-slate-500"}`}>{it.jp}</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <LogoMark box="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight leading-none">
          <span className="text-white tracking-wide">KAWAI</span><span className="text-white tracking-wide"> CAMP</span>
        </span>
      </div>

      <div className="px-2">
        {TOP.map((it) => <Item key={it.key} it={it} />)}
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

      <div className="px-2 pb-1">
        <Item it={HELP} />
      </div>

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
