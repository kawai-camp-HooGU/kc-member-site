"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** 確認ダイアログを Promise で扱うフック。`if (!(await confirm({message}))) return;` の形で使う。 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm は ConfirmProvider の内側で使ってください");
  return fn;
}

// アプリ共通の確認ダイアログ。ネイティブ window.confirm の置き換え。
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={() => close(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            {opts.title && <h3 className="font-bold text-gray-800 mb-2">{opts.title}</h3>}
            <div className="text-sm text-gray-600 mb-4 whitespace-pre-wrap">{opts.message}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => close(false)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                {opts.cancelLabel ?? "キャンセル"}</button>
              <button onClick={() => close(true)}
                className={`text-sm px-5 py-2 rounded-lg text-white font-medium ${opts.danger ? "bg-red-600 hover:bg-red-700" : "bg-neutral-800 hover:bg-neutral-900"}`}>
                {opts.confirmLabel ?? "OK"}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
