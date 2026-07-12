"use client";
import { useState } from "react";
import type { ReactNode } from "react";

export interface InlineFormProps {
  title: ReactNode;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onDelete?: (() => void) | null;
  children: ReactNode;
  canSave?: boolean;
}

// マスタ共通の編集モーダル枠（保存/削除/キャンセル）
// 二重送信ガード: 保存中は onSave の完了までボタンを無効化し「保存中...」表示。
export function InlineForm({ title, onClose, onSave, onDelete, children, canSave = true }: InlineFormProps) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      await onSave();
    } catch (e) {
      console.error("保存エラー:", e);
    } finally {
      setSaving(false);
    }
  };

  const guardedClose = () => { if (!saving) onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={guardedClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={guardedClose} disabled={saving}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-40">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {children}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 items-center">
          {onDelete && (
            <button onClick={onDelete} disabled={saving}
              className="text-sm py-2.5 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">削除</button>
          )}
          <div className="flex-1" />
          <button onClick={guardedClose} disabled={saving}
            className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40">キャンセル</button>
          <button onClick={handleSave} disabled={!canSave || saving}
            className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
