"use client";
// ============================================================
// 待たせている順 Top5（REQ-027 / P2-a）
//   件数では見えない「1件の放置」を拾うためのパネル。
//   ⚠️ P1 では対象がフォーム回答のみ。遷移先は静的ルート
//      /ops/submissions/[id] なので、buildPath は通さず直接 push する
//      （lib/routes.ts のコメント参照：静的ルートは変換の対象外）。
// ============================================================
import { Icon } from "../common/Icon";
import { CARD, CARD_HEAD, SUCCESS_CONFIG, waitCls } from "../../lib/constants";
import { elapsedLabel } from "../../lib/opsDashboard";
import type { WaitingItem } from "../../lib/opsDashboard";

export interface OldestWaitingListProps {
  items: WaitingItem[];
  loading: boolean;
  /** 担当者ID → 表示名 */
  assigneeName: (id: string) => string;
  onOpenHref: (href: string) => void;
}

export function OldestWaitingList({ items, loading, assigneeName, onOpenHref }: OldestWaitingListProps) {
  return (
    <section className={`${CARD} overflow-hidden flex flex-col`}>
      <div className={CARD_HEAD}>
        <Icon name="clock" size={14} />
        <span className="text-[12px] font-bold text-white">待たせている順</span>
        <span className="ml-auto text-[10.5px] font-semibold text-gray-300">古い順に最大5件</span>
      </div>

      {loading && <div className="px-3.5 py-6 text-center text-[11.5px] text-gray-400">…</div>}

      {!loading && items.length === 0 && (
        <div className="px-3 py-8 text-center">
          <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${SUCCESS_CONFIG.bg} ${SUCCESS_CONFIG.icon} mb-1.5`}>
            <Icon name="check" size={19} />
          </span>
          <p className={`text-[12.5px] font-bold ${SUCCESS_CONFIG.text}`}>待たせている案件はありません</p>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {items.map((w) => {
          const name = w.assignee ? assigneeName(w.assignee) : "";
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onOpenHref(w.href)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <span className={`shrink-0 min-w-[54px] text-[11px] font-extrabold tabular-nums ${waitCls(w.elapsedMs)}`}>
                {elapsedLabel(w.elapsedMs)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11.5px] font-bold text-gray-700 truncate">{w.title}</span>
                <span className="block text-[9.5px] text-gray-400 truncate">{w.desc}</span>
              </span>
              <span
                className={`shrink-0 text-[9px] font-bold rounded-full px-2 py-0.5 border ${
                  name ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-red-50 text-red-700 border-red-200"
                }`}
              >
                {name || "未割当"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
