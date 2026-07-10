"use client";
import { useMemo, useState } from "react";
import type { ChatThread, Role } from "../../lib/models";
import { avatarColor, initial, roleBadge } from "./chatUtils";

export interface SearchModalProps {
  threads: ChatThread[];
  onSelect: (conversationId: number) => void;
  onClose: () => void;
}

const ROLE_FILTERS: (Role | "すべて")[] = ["すべて", "管理者", "オペレーター", "メンバー", "外部"];

export function SearchModal({ threads, onSelect, onClose }: SearchModalProps) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "すべて">("すべて");
  const results = useMemo(() => {
    const kw = q.trim();
    return threads.filter((t) => {
      if (role !== "すべて" && t.member.role !== role) return false;
      if (!kw) return true;
      const m = t.member;
      return m.name.includes(kw) || m.company.includes(kw) || m.email.includes(kw);
    });
  }, [threads, q, role]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-5" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <b className="text-base">メンバー〈顧客〉を検索</b>
          <button onClick={onClose} className="ml-auto text-xl text-gray-400 leading-none">✕</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 名前・所属・メールで検索"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:border-red-400" />
          <div className="flex gap-1.5 flex-wrap my-3">
            {ROLE_FILTERS.map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={`text-[11.5px] border rounded-full px-2.5 py-1 font-semibold ${role === r ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-500 border-gray-200"}`}>{r}</button>
            ))}
          </div>
          {results.length === 0 && <p className="text-gray-400 text-xs py-3">該当するメンバーがいません</p>}
          {results.map((t) => {
            const rb = roleBadge(t.member.role);
            return (
              <button key={t.conversationId} onClick={() => onSelect(t.conversationId)}
                className="flex items-center gap-2.5 w-full text-left py-2.5 border-t border-gray-100 hover:bg-gray-50">
                <span className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-xs shrink-0" style={{ background: avatarColor(t.member.id) }}>{initial(t.member.name)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold truncate">{t.member.name}</span>
                  <span className="block text-[11.5px] text-gray-400 truncate">{rb.label}・{t.member.company || "所属なし"}</span>
                </span>
                {t.unread > 0 && <span className="bg-red-600 text-white min-w-[20px] h-5 rounded-full grid place-items-center text-[11px] font-bold px-1.5">{t.unread}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
