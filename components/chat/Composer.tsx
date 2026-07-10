"use client";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MAX_ATTACH_BYTES, fmtSizeGuard } from "./composerHelpers";

export interface ComposerProps {
  text: string;
  setText: (v: string) => void;
  onSend: (body: string, files: File[]) => void;
  sending?: boolean;
  placeholder?: string;
}

export function Composer({ text, setText, onSend, sending, placeholder }: ComposerProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const tooBig = picked.find((f) => f.size > MAX_ATTACH_BYTES);
    if (tooBig) { setErr(`「${tooBig.name}」は20MBを超えています`); return; }
    setErr("");
    setFiles((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = "";
  };
  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    if (sending) return;
    if (!text.trim() && files.length === 0) return;
    onSend(text.trim(), files);
    setFiles([]);
    setErr("");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <div>
      {err && <div className="px-4 pt-2 text-xs text-red-500">{err}</div>}
      {files.length > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg px-2.5 py-1 text-xs font-medium">
              📄 {f.name}・{fmtSizeGuard(f.size)}
              <button type="button" onClick={() => removeFile(i)} className="opacity-60 font-bold">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="border-t border-gray-200 bg-white px-4 py-2.5 flex gap-2 items-end">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <button type="button" onClick={() => fileRef.current?.click()} title="ファイルを添付"
          className="w-10 h-10 border border-gray-200 rounded-lg text-gray-500 text-lg grid place-items-center hover:border-red-400 hover:text-red-500 shrink-0">📎</button>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={placeholder ?? "メッセージを入力…（⌘/Ctrl+Enterで送信）"}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none min-h-[40px] max-h-32 focus:outline-none focus:border-red-400" rows={1} />
        <button type="button" onClick={submit} disabled={sending}
          className="bg-red-600 text-white font-bold rounded-xl px-4 h-10 text-sm hover:bg-red-700 disabled:opacity-50 shrink-0">
          {sending ? "送信中" : "送信"}
        </button>
      </div>
    </div>
  );
}
