"use client";
// ============================================================
// メッセージ入力欄
//
//   【添付の取り込み口は3つ、処理は1本】
//     A. 添付ボタン（<input type="file">）
//     B. クリップボード貼り付け（Ctrl/⌘+V）… スクショを撮ってそのまま貼れる
//     C. ドラッグ&ドロップ … 受付範囲は入力欄まわり全体（的が小さいと外して離脱する）
//   いずれも addFiles() に集約する。
//
//   【レイアウト】
//     shrink-0 を付けて、履歴が増えても入力欄が潰れないようにする。
//     ⚠️ 親（Conversation / staffPane）側には min-h-0 が要る。無いと会話ペインが
//        縮まなくなり、この入力欄が枠外へ押し出されて切り落とされる。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import {
  MAX_ATTACH_BYTES, MAX_ATTACH_COUNT, fmtSizeGuard, isImageFile,
  loadSendOnEnter, saveSendOnEnter, pastedFileName,
} from "./composerHelpers";
import { fileExt } from "./chatUtils";
import { Icon } from "../common/Icon";

/** 入力欄に載っている添付1件 */
interface Attached {
  key: string;
  file: File;
  /** 画像のときだけ作るプレビュー用 blob URL */
  previewUrl: string | null;
}

export interface ComposerProps {
  text: string;
  setText: (v: string) => void;
  onSend: (body: string, files: File[]) => void;
  sending?: boolean;
  placeholder?: string;
  /** 引用返信の対象（設定されていると入力欄の上に引用が出る） */
  replyTo?: { id: number; body: string } | null;
  onCancelReply?: () => void;
}

const newKey = (): string =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `k${Date.now()}${Math.random()}`;

export function Composer({ text, setText, onSend, sending, placeholder, replyTo, onCancelReply }: ComposerProps) {
  const [files, setFiles] = useState<Attached[]>([]);
  const [err, setErr] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(false);
  const dragDepth = useRef(0);           // dragenter/leave の入れ子で点滅させない
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 個人設定の復元（SSR中は触らない）
  useEffect(() => { setSendOnEnter(loadSendOnEnter()); }, []);

  // 入力量に応じて高さを自動調整（max-h-32 で上限、その先はスクロール）
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  // blob URL はアンマウント時に必ず解放する（放置するとタブのメモリを食う）
  useEffect(() => () => {
    setFiles((prev) => { prev.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); return []; });
  }, []);

  const toAttached = (file: File): Attached => ({
    key: newKey(),
    file,
    previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
  });

  /** A/B/C すべての取り込み口の共通処理 */
  const addFiles = useCallback((picked: File[]): void => {
    if (picked.length === 0) return;
    setErr("");
    setFiles((prev) => {
      const msgs: string[] = [];
      // 大きすぎるものは「そのファイルだけ」弾く（1件でも超えたら全部捨てる、はしない）
      const sized = picked.filter((f) => {
        if (f.size > MAX_ATTACH_BYTES) { msgs.push(`「${f.name}」は20MBを超えています`); return false; }
        return true;
      });
      const room = Math.max(0, MAX_ATTACH_COUNT - prev.length);
      const taken = sized.slice(0, room);
      const dropped = sized.length - taken.length;
      if (dropped > 0) msgs.push(`添付は${MAX_ATTACH_COUNT}件までです（${dropped}件を追加できませんでした）`);
      if (msgs.length > 0) setErr(msgs.join(" ／ "));
      return taken.length > 0 ? [...prev, ...taken.map(toAttached)] : prev;
    });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const removeFile = (key: string): void =>
    setFiles((prev) => {
      const t = prev.find((f) => f.key === key);
      if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((f) => f.key !== key);
    });

  // ── B. 貼り付け ──
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const picked: File[] = [];
    const existing = files.map((f) => f.file.name);
    for (const it of items) {
      if (it.kind !== "file") continue;
      const f = it.getAsFile();
      if (!f) continue;
      // クリップボード由来は名前が image.png 固定なので付け直す
      const named = f.name && f.name !== "image.png"
        ? f
        : new File([f], pastedFileName(f.type, [...existing, ...picked.map((p) => p.name)]), { type: f.type });
      picked.push(named);
    }
    if (picked.length === 0) return;   // 画像が取れなければテキスト貼付を邪魔しない
    e.preventDefault();
    addFiles(picked);
  };

  // ── C. ドラッグ&ドロップ ──
  const onDragEnter = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();   // これが無いとブラウザが画像を開いて会話画面から離脱する
  };
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  const submit = (): void => {
    if (sending) return;
    if (!text.trim() && files.length === 0) return;
    onSend(text.trim(), files.map((f) => f.file));
    files.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    setFiles([]);
    setErr("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter") return;
    // ⚠️ IMEの変換確定の Enter では絶対に送信しない
    if (e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); submit(); return; }
    if (sendOnEnter && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const toggleEnter = (): void => {
    const next = !sendOnEnter;
    setSendOnEnter(next);
    saveSendOnEnter(next);
  };

  return (
    <div className="shrink-0 relative"
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

      {/* 引用返信のプレビュー */}
      {replyTo && (
        <div className="px-4 pt-2">
          <div className="flex items-start gap-2 bg-blue-50 border-l-[3px] border-blue-400 rounded-r px-2.5 py-1.5">
            <span className="text-[10.5px] font-bold text-blue-700 shrink-0">↩ 返信先</span>
            <span className="text-[11.5px] text-gray-600 flex-1 min-w-0 truncate">
              {replyTo.body || "（添付ファイル）"}
            </span>
            <button type="button" onClick={onCancelReply} aria-label="引用を外す"
              className="text-gray-400 hover:text-red-500 shrink-0"><Icon name="close" size={13} /></button>
          </div>
        </div>
      )}

      {err && <div className="px-4 pt-2 text-xs text-red-500">{err}</div>}

      {/* 添付チップ：画像はサムネイル、それ以外は拡張子バッジ */}
      {files.length > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-2 max-h-28 overflow-y-auto">
          {files.map((f) => (
            <span key={f.key} className="relative inline-flex items-center">
              {f.previewUrl ? (
                <span className="block w-14 h-14 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 送信前のローカル blob URL */}
                  <img src={f.previewUrl} alt={f.file.name} className="w-full h-full object-cover" />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 h-14 bg-gray-50 border border-gray-200 rounded-lg px-2.5 text-[11px] font-medium text-gray-700 max-w-[190px]">
                  <span className="w-7 h-7 rounded bg-red-600 text-white text-[9px] font-extrabold grid place-items-center shrink-0">
                    {fileExt(f.file.name, f.file.type)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{f.file.name}</span>
                    <span className="block text-[10px] text-gray-400">{fmtSizeGuard(f.file.size)}</span>
                  </span>
                </span>
              )}
              <button type="button" onClick={() => removeFile(f.key)} aria-label={`${f.file.name} を外す`}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800/80 text-white grid place-items-center">
                <Icon name="close" size={10} stroke={2.6} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-gray-200 bg-white px-4 py-2.5 flex gap-2 items-end">
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))} />
        <button type="button" onClick={() => fileRef.current?.click()} title="ファイルを添付" aria-label="ファイルを添付"
          className="w-10 h-10 border border-gray-200 rounded-lg text-gray-500 grid place-items-center hover:border-red-400 hover:text-red-500 shrink-0">
          <Icon name="paperclip" size={18} />
        </button>
        <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey} onPaste={onPaste}
          placeholder={placeholder ?? (sendOnEnter
            ? "メッセージを入力…（Ctrl+V で画像を貼り付け・Enterで送信）"
            : "メッセージを入力…（Ctrl+V で画像を貼り付け・⌘/Ctrl+Enterで送信）")}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none min-h-[40px] max-h-32 overflow-y-auto focus:outline-none focus:border-red-400"
          rows={1} />
        <button type="button" onClick={submit} disabled={sending} aria-label="送信"
          className="bg-red-600 text-white font-bold rounded-xl px-3 sm:px-4 h-10 text-sm hover:bg-red-700 disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5">
          <Icon name="send" size={16} />
          <span className="hidden sm:inline">{sending ? "送信中" : "送信"}</span>
        </button>
      </div>

      {/* Enter送信の個人設定（この端末にだけ保存される） */}
      <div className="px-4 pb-1.5 -mt-1 flex justify-end">
        <button type="button" onClick={toggleEnter}
          className="text-[10px] text-gray-400 hover:text-red-500"
          title="この端末にだけ保存されます">
          {sendOnEnter ? "Enterで送信（Shift+Enterで改行）" : "Enterで改行（⌘/Ctrl+Enterで送信）"}　切替
        </button>
      </div>

      {/* ドラッグ中のオーバーレイ */}
      {dragging && (
        <div className="absolute inset-0 z-10 bg-red-50/80 border-2 border-dashed border-red-400 rounded-lg flex flex-col items-center justify-center gap-1 pointer-events-none">
          <Icon name="photo" size={26} className="text-red-500" />
          <b className="text-[13px] text-red-700">ここにドロップして添付</b>
          <span className="text-[10.5px] text-gray-500">1ファイル20MBまで／最大{MAX_ATTACH_COUNT}件</span>
        </div>
      )}
    </div>
  );
}
