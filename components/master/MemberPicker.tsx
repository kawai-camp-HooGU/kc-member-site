"use client";
import { useState, useRef, useEffect } from "react";
import type { Member } from "../../lib/models";

export interface MemberPickerProps {
  selected: string[];
  onChange: (names: string[]) => void;
  members: Member[];
}

export function MemberPicker({ selected, onChange, members }: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const sel = selected ?? [];
  const add = (name: string) => { if (!sel.includes(name)) onChange([...sel, name]); };
  const remove = (name: string) => onChange(sel.filter((n) => n !== name));
  const avail = members.filter((m) => !m.isDeleted && !sel.includes(m.name) && m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="border border-gray-300 rounded-lg p-2 bg-white">
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
        {sel.length === 0 && <span className="text-xs text-gray-400 py-0.5">メンバー未選択</span>}
        {sel.map((name) => (
          <span key={name} className="inline-flex items-center gap-1 bg-blue-50 text-red-700 border border-red-200 rounded-full pl-2.5 pr-1 py-0.5 text-xs">
            {name}
            <button type="button" onClick={() => remove(name)}
              className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-100 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="relative" ref={ref}>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between border border-dashed border-red-300 rounded-lg px-3 py-1.5 text-xs text-red-600 hover:bg-blue-50 transition-colors">
          ＋ メンバーを追加 <span className="text-[10px]">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-56 overflow-y-auto">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="メンバーを検索…"
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs mb-1 focus:outline-none focus:border-red-400" />
            {members.length === 0 ? (
              <p className="text-xs text-gray-400 px-1 py-1">メンバーマスタにメンバーがいません</p>
            ) : avail.length === 0 ? (
              <p className="text-xs text-gray-400 px-1 py-1">該当するメンバーがいません</p>
            ) : avail.map((m) => (
              <button key={m.name} type="button" onClick={() => add(m.name)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-blue-50">
                <span className="text-gray-700">{m.name}</span>
                <span className="text-gray-400">（{m.role}）</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
