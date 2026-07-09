"use client";
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { gridCellNav } from "../../lib/gridNav";
import type { Task, Member } from "../../lib/models";

interface Rect { left: number; top: number; width: number; }

export interface GridAssigneeCellProps {
  task: Task;
  members: Member[];
  canEdit: boolean;
  onChange: (task: Task, names: string[]) => void;
  clip: string[] | null;
  setClip: (v: string[]) => void;
  width: number;
  rowH: number;
  badgeSz: number | string;
  subColor: string;
  subBold: string;
}

// ガントのグリッド上でメンバーを直接編集するセル
export function GridAssigneeCell({ task, members, canEdit, onChange, clip, setClip, width, rowH, badgeSz, subColor, subBold }: GridAssigneeCellProps) {
  const [open, setOpen]   = useState(false);
  const [rect, setRect]   = useState<Rect | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const cellRef = useRef<HTMLDivElement>(null);

  const sel     = task.assignees ?? [];
  const avail   = (members ?? []).filter((m) => !m.isDeleted);
  const nameSet = new Set(avail.map((m) => m.name));

  const close = () => { setOpen(false); setError(""); setQuery(""); };

  const computeRect = (): Rect => {
    const el = cellRef.current;
    if (!el) return { left: 8, top: 8, width: 230 };
    const r = el.getBoundingClientRect();
    const popH = 300;
    const top = (window.innerHeight - r.bottom) >= 180 ? r.bottom + 4 : Math.max(8, r.top - popH - 4);
    return { left: Math.max(8, Math.min(r.left, window.innerWidth - 250)), top, width: Math.max(r.width, 230) };
  };
  const openEditor = () => { if (!canEdit) return; setRect(computeRect()); setOpen(true); };

  const toggle     = (name: string) => { onChange(task, sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name]); setError(""); };
  const removeChip = (name: string) => onChange(task, sel.filter((n) => n !== name));

  const parseNames = (text: string): string[] => text.split(/[,、　\s]+/).map((s) => s.trim()).filter(Boolean);

  const commit = (text: string) => {
    const parts = parseNames(text);
    if (!parts.length) return;
    const unknown = parts.filter((p) => !nameSet.has(p));
    if (unknown.length) { setError(`未登録のメンバーです：${unknown.join("、")}（登録できません）`); return; }
    onChange(task, Array.from(new Set([...sel, ...parts])));
    setError(""); setQuery("");
  };

  const pasteReplace = (text: string) => {
    const parts = parseNames(text);
    if (!parts.length) return;
    const unknown = parts.filter((p) => !nameSet.has(p));
    if (unknown.length) { setQuery(text); setError(`未登録のメンバーです：${unknown.join("、")}（登録できません）`); setRect(computeRect()); setOpen(true); return; }
    onChange(task, Array.from(new Set(parts)));
  };

  const copyCell = () => { setClip(sel); try { if (navigator.clipboard) navigator.clipboard.writeText(sel.join(", ")); } catch { /* noop */ } };

  const filtered = avail.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={cellRef}
      tabIndex={canEdit ? 0 : undefined}
      data-grow={task.id} data-gcol="assignees"
      title={canEdit ? "矢印キーで移動 ／ ダブルクリックで編集 ／ Ctrl+C・Ctrl+V・Ctrl+Z" : undefined}
      className={`group flex items-center gap-1 px-2 overflow-hidden border-r border-gray-100 shrink-0 outline-none ${canEdit ? "cursor-pointer focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-red-400" : ""}`}
      style={{ width, minHeight: rowH }}
      onClick={(e) => { e.stopPropagation(); }}
      onDoubleClick={(e) => { e.stopPropagation(); openEditor(); }}
      onKeyDown={(e) => {
        if (!canEdit) return;
        if (gridCellNav(e, task.id, "assignees")) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyCell(); }
        else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); openEditor(); }
      }}
      onPaste={(e) => {
        if (!canEdit) return;
        const text = e.clipboardData.getData("text");
        e.preventDefault();
        if (text && text.trim()) pasteReplace(text);
        else if (clip) onChange(task, [...clip]);
      }}>
      <span className={`flex-1 min-w-0 truncate ${subColor} ${subBold}`} style={{ fontSize: badgeSz }}>
        {sel.length ? sel.join(", ") : <span className="text-gray-300">メンバー</span>}
      </span>
      {canEdit && (
        <span className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button title="このメンバーをコピー（Ctrl+C）" onClick={copyCell}
            className="text-gray-400 hover:text-red-600 px-0.5 leading-none">⧉</button>
        </span>
      )}

      {open && rect && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={close} />
          <div className="fixed z-[56] bg-white border border-gray-200 rounded-lg shadow-2xl"
            style={{ left: rect.left, top: rect.top, width: rect.width }}
            onClick={(e) => e.stopPropagation()}>
            <div className="p-2 border-b border-gray-100">
              <div className="flex flex-wrap gap-1 mb-1.5 min-h-[1.25rem]">
                {sel.length === 0 && <span className="text-xs text-gray-400 py-0.5">未選択</span>}
                {sel.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 bg-blue-50 text-red-700 border border-red-200 rounded-full pl-2 pr-1 py-0.5 text-xs">
                    {n}
                    <button onClick={() => removeChip(n)} className="text-red-400 hover:text-red-700 leading-none">✕</button>
                  </span>
                ))}
              </div>
              <input autoFocus value={query}
                onChange={(e) => { setQuery(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(query); } if (e.key === "Escape") close(); }}
                onPaste={(e) => { e.preventDefault(); commit(e.clipboardData.getData("text")); }}
                placeholder="検索 / 入力 / 貼り付け"
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-red-400" />
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">該当するメンバーがいません</p>}
              {filtered.map((m) => {
                const on = sel.includes(m.name);
                return (
                  <button key={m.id ?? m.name} onClick={() => toggle(m.name)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 ${on ? "bg-blue-50" : ""}`}>
                    <span className={on ? "text-red-600" : "text-gray-300"}>{on ? "☑" : "☐"}</span>
                    <span className="text-gray-700">{m.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end p-2 border-t border-gray-100">
              <button onClick={close} className="text-xs px-4 py-1 rounded bg-red-600 text-white hover:bg-red-700">完了</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
