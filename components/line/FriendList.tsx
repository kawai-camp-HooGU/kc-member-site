"use client";
// LINE友だち一覧（トーク画面の左カラム）。新着を上に、未読バッジと連携状態を表示。
import { useMemo, useState } from "react";
import type { LineAccount, LineFriend } from "../../lib/models";
import { fmtTime, statusStyle } from "./lineUtils";
import { FriendAvatar } from "./FriendAvatar";

export interface FriendListProps {
  friends: LineFriend[];
  unreadMap: Record<number, number>;
  selectedId: number | null;
  onSelect: (friendId: number) => void;
  /** 接続中のLINEアカウント（表示・切替用） */
  accounts?: LineAccount[];
  accountId?: number | null;
  onSelectAccount?: (id: number) => void;
}

type Tab = "unread" | "linked" | "unlinked" | "all";
const TAB_LABEL: Record<Tab, string> = {
  unread: "未読", linked: "会員連携済", unlinked: "未連携", all: "すべて",
};

export function FriendList({
  friends, unreadMap, selectedId, onSelect,
  accounts = [], accountId = null, onSelectAccount,
}: FriendListProps) {
  const [tab, setTab] = useState<Tab>("all");
  const currentAccount = accounts.find((a) => a.id === accountId) ?? null;

  const shown = useMemo(() => {
    return friends.filter((f) => {
      if (tab === "unread") return (unreadMap[f.id] ?? 0) > 0;
      if (tab === "linked") return f.memberId != null;
      if (tab === "unlinked") return f.memberId == null;
      return true;
    });
  }, [friends, unreadMap, tab]);

  return (
    <div className="w-full border-r border-gray-200 bg-white h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2">
          <h2 className="text-xs text-gray-500 font-bold flex items-center gap-2 flex-shrink-0">
            友だち
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
          </h2>
          {/* 表示中の公式アカウント。複数接続時はプルダウンで切替 */}
          {accounts.length > 1 ? (
            <select
              value={accountId ?? ""}
              onChange={(e) => onSelectAccount?.(Number(e.target.value))}
              className="ml-auto max-w-[150px] text-[12px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 truncate"
              title="表示する公式アカウントを切り替え"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.channelId}</option>
              ))}
            </select>
          ) : currentAccount ? (
            <span className="ml-auto max-w-[160px] truncate text-[12px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1" title={currentAccount.name}>
              {currentAccount.name || currentAccount.channelId}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {(Object.keys(TAB_LABEL) as Tab[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 text-[11px] font-bold rounded-md py-1 ${
                tab === k ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"
              }`}
            >
              {TAB_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-gray-400">該当する友だちはいません</div>
      )}

      {shown.map((f) => {
        const unread = unreadMap[f.id] ?? 0;
        const on = f.id === selectedId;
        const st = statusStyle(f.status);
        const name = f.displayName || "(名称未取得)";
        return (
          <button
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={`w-full text-left px-4 py-2.5 border-b border-gray-100 relative block ${
              on ? "bg-emerald-50 shadow-[inset_3px_0_0_#06c755]" : "hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <FriendAvatar name={name} pictureUrl={f.pictureUrl} seed={f.lineUserId} size={32} />
              <span className={`text-sm truncate ${unread > 0 ? "font-extrabold" : "font-bold"}`}>{name}</span>
              <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">{fmtTime(f.lastMessageAt)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1 truncate pr-9">{f.lastMessageSnip || "―"}</div>
            <div className="flex gap-1.5 mt-1 items-center">
              <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
              <span
                className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${
                  f.memberId != null ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {f.memberId != null ? "会員連携済" : "未連携"}
              </span>
            </div>
            {unread > 0 && (
              <span className="absolute right-3 bottom-2.5 bg-emerald-500 text-white min-w-[19px] h-[19px] rounded-full grid place-items-center text-[10.5px] font-extrabold px-1.5">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
