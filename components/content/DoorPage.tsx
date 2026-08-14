"use client";
// ============================================================
// セクション扉ページの描画
//
//   運営が書いたHTML（content_sections.door_html）をハブ本体として描画する。
//   dangerouslySetInnerHTML に渡すのは
//     resolveDoorHtml(sanitizeDoorHtml(html).html, ctx)
//   の戻り値のみ。この順序（サニタイズ → 解決）を崩さない。
//
//   クリックは委譲で拾う。解決器が付けた data-page-id を見て
//   SPA遷移（?p= の付け替え）に変える。a タグには href も付いているので、
//   中クリック・右クリック「新しいタブで開く」も正しく動く。
// ============================================================
import { useEffect, useMemo, useRef } from "react";
import { sanitizeDoorHtml } from "../../lib/ai/sanitizeDoor";
import { resolveDoorHtml, type DoorContext } from "../../lib/doorPage";

export interface DoorPageProps {
  /** content_sections.door_html（未サニタイズでも可。ここで必ず通す） */
  html: string;
  ctx: DoorContext;
  /** ページを開く（?p= の付け替え） */
  onOpenPage: (pageId: number) => void;
}

export function DoorPage({ html, ctx, onOpenPage }: DoorPageProps) {
  const ref = useRef<HTMLDivElement>(null);

  // ⚠️ サニタイズ → 解決 の順。逆にすると注入された属性を信用することになる。
  const safe = useMemo(
    () => resolveDoorHtml(sanitizeDoorHtml(html).html, ctx),
    [html, ctx],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      // 修飾キー・中クリックはブラウザ既定（新しいタブ等）に任せる
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const hit = target?.closest?.("[data-page-id]");
      if (!hit) return;
      const id = Number(hit.getAttribute("data-page-id"));
      if (!Number.isFinite(id) || id <= 0) return;
      e.preventDefault();
      onOpenPage(id);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [onOpenPage, safe]);

  return <div ref={ref} className="door-root" dangerouslySetInnerHTML={{ __html: safe }} />;
}
