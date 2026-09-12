"use client";
// ============================================================
// 次の予定（REQ-094）
//   直近のイベントを1〜3件。日付を大きく出して「時間で変わる」ことを見せる。
//   0件なら出さない（設計書 §11-5＝a）。
// ============================================================
import { Icon } from "../common/Icon";
import { CARD, HOME_SECTION } from "../../lib/constants";
import { eventRangeLabel } from "../../lib/events";
import type { HomeBlock, CalEvent } from "../../lib/models";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

export interface EventBlockProps {
  block: HomeBlock;
  /** 表示対象に絞り込み済み・開始が近い順のイベント */
  items: CalEvent[];
  onOpen: () => void;
}

export function EventBlock({ block: b, items, onOpen }: EventBlockProps) {
  if (items.length === 0) return null;

  const list = items.slice(0, Math.max(1, b.config.limit ?? 1));

  return (
    <section className={HOME_SECTION}>
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
          <Icon name="calendar" size={15} className="text-gray-500" />
          <span className="text-[13px] font-bold text-gray-700">{b.title || "次の予定"}</span>
        </div>
        {list.map((e, i) => {
          const d = new Date(e.startAt);
          const ok = !Number.isNaN(d.getTime());
          return (
            <button key={e.id} onClick={onOpen}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50
                          ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <span className="shrink-0 text-center rounded-lg bg-red-50 border border-red-200 px-2.5 py-1">
                <span className="block text-[18px] font-black text-red-700 leading-none tabular-nums">
                  {ok ? d.getDate() : "—"}
                </span>
                <span className="block text-[10px] font-bold text-red-700 mt-0.5">
                  {ok ? `${d.getMonth() + 1}月 ${WD[d.getDay()]}` : ""}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-gray-800 leading-snug truncate">
                  {e.title}
                </span>
                <span className="block text-[12px] text-gray-400 font-bold mt-0.5">
                  {eventRangeLabel(e)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
