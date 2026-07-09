"use client";
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface SettingsPopoverProps {
  children: ReactNode;
  align?: "left" | "right";
  width?: string;
}

// 表示設定ポップオーバー（⚙ボタン + 開閉 + 外側クリックで閉じる）
export function SettingsPopover({ children, align = "left", width = "w-80" }: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border transition-colors ${
          open ? "border-red-400 bg-blue-50 text-red-600" : "border-gray-300 bg-white text-gray-600 hover:border-red-400"
        }`}>
        ⚙ 表示設定 <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 z-40 ${width} overflow-visible bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-3`}>
          {children}
        </div>
      )}
    </div>
  );
}
