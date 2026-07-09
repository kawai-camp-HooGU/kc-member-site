"use client";
import { useState, useRef, useEffect } from "react";
import { gridCellNav } from "../../lib/gridNav";
import { parsePastedDate } from "../../lib/dateUtils";
import type { Task } from "../../lib/models";

export type DateField = "start" | "end";

export interface GridDateCellProps {
  task: Task;
  field: DateField;
  value: string;
  canEdit: boolean;
  onChange: (task: Task, field: DateField, value: string) => void;
  clip: string | null;
  setClip: (v: string) => void;
  width: number;
  rowH: number;
  badgeSz: number | string;
  textCls: string;
}

// ガントのグリッド上で開始日・終了日を編集するセル
export function GridDateCell({ task, field, value, canEdit, onChange, clip, setClip, width, rowH, badgeSz, textCls }: GridDateCellProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.showPicker?.(); } catch { /* noop */ }
    }
  }, [editing]);

  const copyCell  = () => { setClip(value || ""); try { if (navigator.clipboard) navigator.clipboard.writeText(value || ""); } catch { /* noop */ } };
  const pasteText = (text: string) => { const v = parsePastedDate(text); if (v) onChange(task, field, v); };

  return (
    <div
      tabIndex={canEdit ? 0 : undefined}
      data-grow={task.id} data-gcol={field}
      title={canEdit ? "矢印キーで移動 ／ ダブルクリックで編集 ／ Ctrl+C・Ctrl+V・Ctrl+Z" : undefined}
      className={`group flex items-center gap-1 px-1.5 overflow-hidden border-r border-gray-100 shrink-0 outline-none ${canEdit ? "cursor-pointer focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-red-400" : ""}`}
      style={{ width, minHeight: rowH }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); if (canEdit) setEditing(true); }}
      onKeyDown={(e) => {
        if (!canEdit) return;
        if (gridCellNav(e, task.id, field)) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyCell(); }
        else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); setEditing(true); }
      }}
      onPaste={(e) => {
        if (!canEdit) return;
        const text = e.clipboardData.getData("text");
        e.preventDefault();
        if (text && text.trim()) pasteText(text);
        else if (clip) onChange(task, field, clip);
      }}>
      {editing ? (
        <input ref={inputRef} type="date" value={value || ""}
          onChange={(e) => { if (e.target.value) onChange(task, field, e.target.value); }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditing(false); } }}
          className="w-full bg-transparent border border-red-300 rounded outline-none px-0.5"
          style={{ fontSize: badgeSz }} />
      ) : (
        <span className={`flex-1 min-w-0 truncate ${textCls}`} style={{ fontSize: badgeSz }}>
          {value || <span className="text-gray-300">日付</span>}
        </span>
      )}
      {canEdit && !editing && (
        <span className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button title="日付をコピー（Ctrl+C）" onClick={copyCell}
            className="text-gray-400 hover:text-red-600 px-0.5 leading-none">⧉</button>
        </span>
      )}
    </div>
  );
}
