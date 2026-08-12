"use client";
// ============================================================
// Sheet — 中央モーダル ⇄ ボトムシートを1つで賄う共通オーバーレイ
//
//   PC(md以上) … 画面中央のモーダル（従来どおり）
//   スマホ(md未満) … 画面下端から立ち上がるボトムシート（全幅・大タップ域）
//
//   ・スクリム/Esc で閉じる（onClose）
//   ・開いている間は背後（body）のスクロールをロック
//   ・下端はセーフエリア分の余白を確保（ホームバー回避）
//
//   使い方：
//     <Sheet open={open} onClose={() => setOpen(false)} title="タスク詳細">
//       …本文…
//     </Sheet>
// ============================================================
import { useEffect } from "react";
import type { ReactNode } from "react";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** PC時の最大幅（Tailwind の max-w-* 相当のpx）。既定 560。 */
  maxWidth?: number;
  children: ReactNode;
  /** フッター（保存/キャンセル等）。指定時は下部に固定表示。 */
  footer?: ReactNode;
}

export function Sheet({ open, onClose, title, maxWidth = 560, children, footer }: SheetProps) {
  // Esc で閉じる ＋ 開いている間は body スクロールをロック
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth }}
        className="bg-white w-full md:w-full max-h-[88dvh] flex flex-col overflow-hidden
                   rounded-t-2xl md:rounded-2xl shadow-2xl"
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-base font-bold text-gray-800">{title}</h3>
            <button onClick={onClose} aria-label="閉じる"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 text-xl leading-none">×</button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-gray-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
