"use client";
import type { User } from "@supabase/supabase-js";
import type { Permission } from "../../hooks/usePermission";
import { VIEWS } from "./viewConfig";
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

// サイドバー／ドロワー共通の中身
export function SidebarContent({ view, onSelect, permission, user, userInitial, onSignOut, onNavigate }: SidebarContentProps) {
  const go = (k: string) => { onSelect(k); onNavigate && onNavigate(); };
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <LogoMark box="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight leading-none">
          <span className="text-white tracking-wide">KAWAI</span><span className="text-white tracking-wide"> CAMP</span>
        </span>
      </div>
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {VIEWS.filter((v) => v.key !== "master").map((v) => (
          <button key={v.key} onClick={() => go(v.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === v.key ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
            <span className="mr-2">{v.icon}</span>{v.label}
          </button>
        ))}
        {permission.canManageMaster && (
          <>
            <button onClick={() => go("contentset")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === "contentset" ? "bg-red-600 text-white" : "text-slate-400 hover:bg-neutral-800"}`}>
              <span className="mr-2">▤</span>コンテンツ設定
            </button>
            <button onClick={() => go("master")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === "master" ? "bg-red-600 text-white" : "text-slate-400 hover:bg-neutral-800"}`}>
              <span className="mr-2">⚙</span>設定
            </button>
          </>
        )}
      </nav>
      <div className="px-2 pb-1">
        <button onClick={() => go("help")}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === "help" ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
          <span className="mr-2">?</span>ヘルプ
        </button>
      </div>
      <div className="px-3 py-3 border-t border-neutral-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm shrink-0">{userInitial}</div>
          <span className="text-xs text-slate-300 truncate flex-1">{user?.email}</span>
        </div>
        <button onClick={onSignOut} className="w-full text-xs text-slate-400 hover:text-white border border-neutral-700 rounded-lg py-1.5 transition-colors">ログアウト</button>
      </div>
    </div>
  );
}
