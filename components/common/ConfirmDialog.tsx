"use client";
import type { ReactNode } from "react";

export interface ConfirmDialogProps {
  message: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ message, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
        <p className="text-sm text-gray-700 whitespace-pre-line">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 text-sm py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={onConfirm} className="flex-1 text-sm py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">削除する</button>
        </div>
      </div>
    </div>
  );
}
