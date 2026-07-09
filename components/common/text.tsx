"use client";
import { useRef, useEffect } from "react";
import type { ChangeEvent, ReactNode } from "react";

export interface AutoGrowTextareaProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  placeholder?: string;
  className?: string;
}

// 入力量に応じて高さが自動で伸びる textarea（最低 minRows 行を確保）
export function AutoGrowTextarea({ value, onChange, minRows = 2, placeholder, className }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return (
    <textarea ref={ref} rows={minRows} value={value} placeholder={placeholder}
      onChange={onChange} className={className} style={{ resize: "none", overflow: "hidden" }} />
  );
}

// 本文中の URL をリンク化して返す
export function linkifyText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  return String(text).split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-red-600 underline break-all">{part}</a>
      : <span key={i}>{part}</span>
  );
}
