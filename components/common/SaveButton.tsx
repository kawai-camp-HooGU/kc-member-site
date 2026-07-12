"use client";
import { useState } from "react";
import type { ReactNode } from "react";

export interface SaveButtonProps {
  onSave: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;      // 通常時のラベル（既定「保存」）
  savingLabel?: ReactNode;   // 送信中ラベル（既定「保存中...」）
}

// 二重送信ガード付きの保存ボタン。
// クリック後 onSave の完了までボタンを無効化し、ラベルを「保存中...」に切り替える。
// これにより連打による多重 insert/update を防ぐ。
export function SaveButton({
  onSave,
  disabled = false,
  className = "text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
  children = "保存",
  savingLabel = "保存中...",
}: SaveButtonProps) {
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    if (saving || disabled) return;
    setSaving(true);
    try {
      await onSave();
    } catch (e) {
      console.error("保存エラー:", e);
    } finally {
      setSaving(false); // 成功時はモーダルが閉じ unmount されるため no-op
    }
  };

  return (
    <button onClick={handleClick} disabled={disabled || saving} className={className}>
      {saving ? savingLabel : children}
    </button>
  );
}
