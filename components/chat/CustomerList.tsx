"use client";
import { useMemo, useState } from "react";
import type { ChatThread } from "../../lib/models";
import { avatarColor, initial, fmtTime, roleBadge } from "./chatUtils";
import { Icon } from "../common/Icon";

export interface CustomerListProps {
  threads: ChatThread[];
  selectedId: number | null;
  onSelect: (conversationId: number) => void;
  onOpenSearch: () => void;
}

/**
 * ロール絞り込みタブ。
 *   member … 外部**以外**（メンバー・オペレーター・管理者）。「本会員とのやり取り」をまとめて見る用。
 *   external … 外部ロール（フォームから入ってきた見込み客・体験版ユーザー）。
 */
type RoleTab = "all" | "member" | "external";
const TAB_LABEL: Record<RoleTab, string> = { all: "すべて", member: "メンバー", external: "外部" };
const matchTab = (role: string, tab: RoleTab): boolean =>
  tab === "all" ? true : tab === "external" ? role === "外部" : role !== "外部";

export function CustomerList({ threads, selectedId, onSelect, onOpenSearch }: CustomerListProps) {
  const [tab, setTab] = useState<RoleTab>("all");

  const shown = useMemo(
    () => threads.filter((t) => matchTab(t.member.role, tab)),
    [threads, tab],
  );
  /** タブごとの件数（未読 / 全体）。押す前に中身が分かるように出す。 */
  const countOf = (k: RoleTab) => {
    const list = threads.filter((t) => matchTab(t.member.role, k));
    return { total: list.length, unread: list.filter((t) => t.unread > 0).length };
  };

  const totalUnread = shown.filter((t) => t.unread > 0).length;

  return (
    <div className="w-full border-r border-gray-200 bg-white h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
        <h2 className="text-xs text-gray-500 font-bold">
          メンバー〈顧客〉（未読 {totalUnread} / {tab === "all" ? "全" : TAB_LABEL[tab]} {shown.length}）
        </h2>

        {/* ロール切替タブ */}
        <div className="mt-2 flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {(Object.keys(TAB_LABEL) as RoleTab[]).map((k) => {
            const c = countOf(k);
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)}
                className={`flex-1 px-2 py-1.5 rounded-md text-[11.5px] font-bold transition-colors inline-flex items-center justify-center gap-1 ${
                  on ? "bg-white text-neutral-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {TAB_LABEL[k]}
                <span className={`text-[10px] font-bold ${on ? "text-gray-400" : "text-gray-400"}`}>{c.total}</span>
                {c.unread > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" title={`未読 ${c.unread} 件`} />
                )}
              </button>
            );
          })}
        </div>

        <button onClick={onOpenSearch}
          className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 text-left hover:border-red-400 inline-flex items-center gap-1.5">
          <Icon name="search" size={15} /> 名前・所属・ロールで検索
        </button>
      </div>

      {threads.length === 0 && <p className="text-xs text-gray-400 px-4 py-6">会話はまだありません。</p>}
      {threads.length > 0 && shown.length === 0 && (
        <p className="text-xs text-gray-400 px-4 py-6">「{TAB_LABEL[tab]}」に該当する会話はありません。</p>
      )}
      {shown.map((t) => {
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
