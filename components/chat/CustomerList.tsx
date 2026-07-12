"use client";
import type { ChatThread } from "../../lib/models";
import { avatarColor, initial, fmtTime, roleBadge } from "./chatUtils";
import { Icon } from "../common/Icon";

export interface CustomerListProps {
  threads: ChatThread[];
  selectedId: number | null;
  onSelect: (conversationId: number) => void;
  onOpenSearch: () => void;
}

export function CustomerList({ threads, selectedId, onSelect, onOpenSearch }: CustomerListProps) {
  const totalUnread = threads.filter((t) => t.unread > 0).length;
  return (
    <div className="w-full border-r border-gray-200 bg-white h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
        <h2 className="text-xs text-gray-500 font-bold">メンバー〈顧客〉（未読 {totalUnread} / 全 {threads.length}）</h2>
        <button onClick={onOpenSearch}
          className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 text-left hover:border-red-400 inline-flex items-center gap-1.5">
          <Icon name="search" size={15} /> 名前・所属・ロールで検索
        </button>
      </div>
      {threads.length === 0 && <p className="text-xs text-gray-400 px-4 py-6">会話はまだありません。</p>}
      {threads.map((t) => {
        const rb = roleBadge(t.member.role);
        const on = t.conversationId === selectedId;
        return (
          <button key={t.conversationId} onClick={() => onSelect(t.conversationId)}
            className={`block w-full text-left px-4 py-3 border-b border-gray-100 relative hover:bg-gray-50 ${on ? "bg-red-50 shadow-[inset_3px_0_0_#e11d2a]" : ""}`}>
            {t.unread > 0 && <span className="absolute left-1.5 top-3.5 w-1.5 h-1.5 rounded-full bg-red-600" />}
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-xs shrink-0" style={{ background: avatarColor(t.member.id) }}>{initial(t.member.name)}</span>
              <span className={`text-sm truncate ${t.unread > 0 ? "font-extrabold" : "font-semibold"}`}>{t.member.name}</span>
              <span className="ml-auto text-[10.5px] text-gray-400 shrink-0">{fmtTime(t.lastMessageAt)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1 truncate pr-9">{t.lastSnip || "―"}</div>
            <div className="flex gap-1.5 mt-1.5 items-center">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${rb.cls}`}>{rb.label}</span>
              {t.member.company && <span className="text-[10.5px] text-gray-400 truncate">{t.member.company}</span>}
            </div>
            {t.unread > 0 && (
              <span className="absolute right-3.5 bottom-3 bg-red-600 text-white min-w-[20px] h-5 rounded-full grid place-items-center text-[11px] font-extrabold px-1.5">{t.unread}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
