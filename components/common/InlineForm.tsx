"use client";
import type { ReactNode } from "react";

export interface InlineFormProps {
  title: ReactNode;
  onClose: () => void;
  onSave: () => void;
  onDelete?: (() => void) | null;
  children: ReactNode;
  canSave?: boolean;
}

// マスタ共通の編集モーダル枠（保存/削除/キャンセル）
export function InlineForm({ title, onClose, onSave, onDelete, children, canSave = true }: InlineFormProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {children}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 items-center">
          {onDelete && (
            <button onClick={onDelete}
              className="text-sm py-2.5 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">削除</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">キャンセル</button>
          <button onClick={onSave} disabled={!canSave}
            className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">保存</button>
        </div>
      </div>
    </div>
  );
}
