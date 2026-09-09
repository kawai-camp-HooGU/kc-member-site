"use client";
// ============================================================
// お知らせ（REQ-094）
//   改修前の HomeView にあった一覧を、そのままブロックとして切り出したもの。
//   見た目は変えていない。ただし見出し帯の色は生値（bg-[#3f3f46]）の直書きをやめ、
//   lib/constants.ts の CARD / CARD_HEAD を参照する（brand.md §7）。
// ============================================================
import { Icon } from "../common/Icon";
import { CARD, CARD_HEAD } from "../../lib/constants";
import { HOME_SECTION } from "../../lib/constants";
import type { HomeBlock, NewsItem, NewsCategory } from "../../lib/models";

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ",       cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス",   cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント",       cls: "bg-emerald-50 text-emerald-600" },
};

export interface NewsBlockProps {
  block: HomeBlock;
  /** 表示対象に絞り込み済みのお知らせ */
  items: NewsItem[];
  onOpen: (id: number) => void;
  /** 右レールに置くときは字を少し詰める */
  compact?: boolean;
}

export function NewsBlock({ block: b, items, onOpen, compact = false }: NewsBlockProps) {
  if (items.length === 0) return null;          // 0件ならブロックごと出さない

  const limit = Math.max(1, b.config.limit ?? 5);
  const list = items.slice(0, limit);
  const important = items.filter((n) => n.important).length;

  return (
    <section className={HOME_SECTION}>
      <div className={`${CARD} overflow-hidden`}>
        <div className={`${CARD_HEAD} text-zinc-100`}>
          <span className="text-[13px] font-bold inline-flex items-center gap-1.5">
            <Icon name="news" size={15} /> {b.title || "お知らせ"}
          </span>
          {important > 0 && (
            <span className="text-[11px] font-bold text-white bg-red-600 rounded-full px-1.5 py-0.5">
              {important}
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[12px] text-zinc-400">{items.length} 件</span>
        </div>

        {list.map((n, i) => (
          <div key={n.id} onClick={() => onOpen(n.id)}
            className={`flex items-center gap-3 px-4 ${compact ? "py-2.5" : "py-3"}
                        cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-gray-800 leading-snug truncate">{n.title}</div>
              <div className="text-[12px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5">
                {n.important && (
                  <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200
                                   rounded-full px-2 py-0.5">重要</span>
                )}
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${CATS[n.category].cls}`}>
                  {CATS[n.category].label}
                </span>
                <span>{n.publishedAt ? n.publishedAt.slice(0, 10) : ""}</span>
              </div>
            </div>
            <span className="text-gray-300 shrink-0 text-lg" aria-hidden>›</span>
          </div>
        ))}
      </div>
    </section>
  );
}
