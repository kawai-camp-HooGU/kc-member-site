"use client";
// ============================================================
// 棚（REQ-094）
//   continue … あなたがまだ見ていないもの（未視聴・自動）
//   shelf    … 運営が組んだ棚（セクション／ページ／手動／新着）
//   ranking  … 今週よく見られているもの（視聴人数の集計・自動）
//
//   3つとも「横スクロールでカードを並べる」だけなので1部品にまとめる。
//   違うのは並べる元と、順位を出すかどうかだけ。
//
//   ⚠️ 中身が0件のときは、この関数が null を返す＝ブロックごと出さない。
//      見出しだけが並ぶとホームが閑散として見えるため（設計書 §11-5＝a）。
// ============================================================
import { useMemo } from "react";
import { ContentCard } from "./ContentCard";
import { pickForBlock, pickRanking, seenIdsOf } from "../../lib/homeBlocks";
import type { HomePool } from "../../lib/homeBlocks";
import {
  HOME_SECTION, HOME_RAIL_HEAD, HOME_RAIL_TITLE, HOME_RAIL_NOTE, HOME_RAIL_MORE,
} from "../../lib/constants";
import type { HomeBlock, CmsContent, ContentPage } from "../../lib/models";
import type { AttrIndex } from "../../lib/members";

/** 何日以内に作られたものを NEW とするか */
const NEW_DAYS = 14;

export interface ShelfBlockProps {
  block: HomeBlock;
  pool: HomePool;
  myId: number | null;
  myAttrs: number[];
  idx: AttrIndex;
  seeAll: boolean;
  /** カードを押したとき。所属ページも渡す（?p= に載せて戻り先を保つ） */
  onOpen: (c: CmsContent, page: ContentPage | undefined) => void;
  /** 「すべて見る」を押したとき */
  onMore: (b: HomeBlock) => void;
}

export function ShelfBlock({
  block: b, pool, myId, myAttrs, idx, seeAll, onOpen, onMore,
}: ShelfBlockProps) {
  const ranked = useMemo(
    () => (b.kind === "ranking" ? pickRanking(b, pool, myAttrs, idx, seeAll) : []),
    [b, pool, myAttrs, idx, seeAll],
  );
  const items = useMemo(
    () => (b.kind === "ranking" ? [] : pickForBlock(b, pool, myId, myAttrs, idx, seeAll)),
    [b, pool, myId, myAttrs, idx, seeAll],
  );
  const seen = useMemo(() => seenIdsOf(pool.views, myId), [pool.views, myId]);
  const pageOf = useMemo(() => {
    const m = new Map<number, ContentPage>();
    pool.pages.forEach((p) => m.set(p.id, p));
    return m;
  }, [pool.pages]);

  const count = b.kind === "ranking" ? ranked.length : items.length;
  if (count === 0) return null;                 // ← 0件ならブロックごと出さない

  const newFrom = Date.now() - NEW_DAYS * 86400000;
  const isNew = (c: CmsContent): boolean =>
    !!c.createdAt && Date.parse(c.createdAt) >= newFrom;

  const note =
    b.kind === "continue" ? `${items.length}本`
    : b.kind === "ranking" ? (b.config.period === "month" ? "今月の視聴人数" : "今週の視聴人数")
    : `${items.length}件`;

  return (
    <section className={HOME_SECTION}>
      {b.title && (
        <div className={HOME_RAIL_HEAD}>
          <h2 className={HOME_RAIL_TITLE} style={{ wordBreak: "auto-phrase" }}>{b.title}</h2>
          <span className={HOME_RAIL_NOTE}>{note}</span>
          {(b.config.showMore ?? true) && (
            <button className={HOME_RAIL_MORE} onClick={() => onMore(b)}>すべて見る ›</button>
          )}
        </div>
      )}

      {/* 横スクロール。スマホでは右端に次のカードが少し見える幅にしている */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {b.kind === "ranking"
          ? ranked.map((r, i) => (
              <div key={r.content.id} className="snap-start">
                <ContentCard
                  content={r.content}
                  seen={seen.has(r.content.id)}
                  rank={i + 1}
                  note={`${r.viewers}人が視聴`}
                  eager={i < 4}
                  onOpen={() => onOpen(r.content, pageOf.get(r.content.pageId))}
                />
              </div>
            ))
          : items.map((c, i) => (
              <div key={c.id} className="snap-start">
                <ContentCard
                  content={c}
                  seen={seen.has(c.id)}
                  isNew={isNew(c)}
                  eager={i < 4}
                  onOpen={() => onOpen(c, pageOf.get(c.pageId))}
                />
              </div>
            ))}
      </div>
    </section>
  );
}
