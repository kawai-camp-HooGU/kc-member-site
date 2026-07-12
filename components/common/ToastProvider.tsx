"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; text: string; }

export interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** トースト通知フック。`const toast = useToast(); toast.success("保存しました");` */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast は ToastProvider の内側で使ってください");
  return api;
}

// アプリ共通のトースト通知（保存/削除/送信などの完了フィードバック）
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 3000);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (t) => push("success", t),
    error: (t) => push("error", t),
    info: (t) => push("info", t),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div key={t.id}
            className={`px-4 py-2.5 rounded-lg shadow-lg text-sm text-white font-medium ${
              t.kind === "success" ? "bg-green-600" : t.kind === "error" ? "bg-red-600" : "bg-neutral-800"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
