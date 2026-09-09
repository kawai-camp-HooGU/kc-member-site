"use client";
// ============================================================
// 自由HTML（REQ-094）
//
//   ⚠️ 保存時に sanitizeDoorHtml() を通しているが、表示側でももう一度通す。
//      DB の値を信用しない（保存経路が将来増えても、ここが最後の砦になる）。
//      サニタイズの実装は扉ページと同じものを使う。二重に持たない。
// ============================================================
import { useMemo } from "react";
import { sanitizeDoorHtml } from "../../lib/ai/sanitizeDoor";
import { CARD, HOME_SECTION, HOME_RAIL_HEAD, HOME_RAIL_TITLE } from "../../lib/constants";
import type { HomeBlock } from "../../lib/models";

export interface HtmlBlockProps {
  block: HomeBlock;
}

export function HtmlBlock({ block: b }: HtmlBlockProps) {
  const html = useMemo(() => sanitizeDoorHtml(b.bodyHtml).html, [b.bodyHtml]);
  if (!html.trim()) return null;

  return (
    <section className={HOME_SECTION}>
      {b.title && (
        <div className={HOME_RAIL_HEAD}>
          <h2 className={HOME_RAIL_TITLE} style={{ wordBreak: "auto-phrase" }}>{b.title}</h2>
        </div>
      )}
      <div className={`${CARD} p-4 sm:p-5 content-rich text-[15px] leading-relaxed text-gray-700`}
        dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
