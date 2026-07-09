"use client";
import { useState, useEffect, useRef } from "react";
import type { SelectOption } from "../../lib/models";

export interface MultiSelectProps {
  label: string;
  options: SelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}

// チェックボックス付きプルダウン（複数選択・空配列＝すべて）
export function MultiSelect({ label, options, selected, onChange, searchable = false }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const visibleOptions = (searchable && query.trim())
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const allChecked = selected.length === 0;
  const toggle = (val: string) => {
    const next = selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val];
    onChange(next);
  };
  const displayLabel = allChecked
    ? "すべて"
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length}件選択`;

  const BTN = `flex items-center justify-between w-full gap-1 text-xs border rounded-md px-2.5 py-1.5 bg-white cursor-pointer transition-colors
    ${!allChecked ? "border-red-400 text-red-700 bg-blue-50" : "border-gray-300 text-gray-600 hover:border-gray-400"}`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => { const n = !o; if (n) setQuery(""); return n; })} className={BTN}>
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-gray-400 shrink-0">{label}:</span>
          <span className="font-medium truncate">{displayLabel}</span>
        </span>
        <span className="ml-1 text-gray-400 shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-36 py-1 max-h-60 overflow-y-auto">
          {searchable && (
            <div className="sticky top-0 bg-white px-2 pb-1.5 pt-0.5 border-b border-gray-100">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={`${label}を検索...`}
                className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-gray-50 focus:outline-none focus:border-red-400" />
            </div>
          )}
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs text-gray-600">
            <input type="checkbox" checked={allChecked} onChange={() => onChange([])} className="accent-blue-600" />
            すべて
          </label>
          <div className="border-t border-gray-100 my-1" />
          {visibleOptions.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs text-gray-700">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="accent-blue-600" />
              {o.label}
            </label>
          ))}
          {searchable && visibleOptions.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">該当なし</div>
          )}
        </div>
      )}
    </div>
  );
}
