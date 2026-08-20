"use client";
// ============================================================
// 画像の拡大表示（ライトボックス）
//   ・背景クリック / Esc で閉じる
//   ・← → で同じメッセージ内の画像を送る
//   ・右上からダウンロード（署名URLをそのまま使うので追加APIは不要）
//   ⚠️ サムネイルではなく「原本」を表示する（拡大の意味がなくなるため）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import type { ChatAttachment } from "../../lib/models";
import { signedUrls } from "../../lib/chatStorage";
import { fmtSize } from "./chatUtils";
import { Icon } from "../common/Icon";

export interface LightboxProps {
  images: ChatAttachment[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

export function Lightbox({ images, index, onIndexChange, onClose }: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const current = images[index];
  const many = images.length > 1;

  const step = useCallback((d: number) => {
    if (!many) return;
    onIndexChange((index + d + images.length) % images.length);
  }, [index, images.length, many, onIndexChange]);

  // 原本の署名URLを取得
  useEffect(() => {
    if (!current) return;
    let alive = true;
    setUrl(null); setFailed(false);
    signedUrls([current.storagePath])
      .then((m) => { if (alive) { const u = m.get(current.storagePath); u ? setUrl(u) : setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [current]);

  // キー操作は開いている間だけ購読する
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-3 text-gray-200 bg-gradient-to-b from-black/60 to-transparent">
        <b className="text-[12.5px] truncate">{current.fileName}</b>
        <span className="text-[11px] text-gray-400 shrink-0">{fmtSize(current.sizeBytes)}</span>
        <div className="ml-auto flex gap-2 shrink-0">
          {url && (
            <a href={url} download={current.fileName} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/30 rounded-lg px-2.5 py-1 hover:bg-white/10">
              <Icon name="download" size={13} /> ダウンロード
            </a>
          )}
          <button type="button" onClick={onClose} aria-label="閉じる"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold border border-white/30 rounded-lg px-2.5 py-1 hover:bg-white/10">
            <Icon name="close" size={13} /> 閉じる
          </button>
        </div>
      </div>

      {failed ? (
        <p className="text-sm text-gray-300">画像を表示できませんでした。</p>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 署名URL（有効期限つき）のため next/image は使えない
        <img src={url} alt={current.fileName} onError={() => setFailed(true)}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[84vh] rounded object-contain" />
      ) : (
        <p className="text-sm text-gray-400">読み込み中…</p>
      )}

      {many && (
        <>
          <button type="button" aria-label="前の画像" onClick={(e) => { e.stopPropagation(); step(-1); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 text-white grid place-items-center hover:bg-white/25">
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" aria-label="次の画像" onClick={(e) => { e.stopPropagation(); step(1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 text-white grid place-items-center hover:bg-white/25">
            <Icon name="chevronRight" size={20} />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-gray-300 bg-black/50 rounded-full px-3 py-0.5">
            {index + 1} / {images.length}　←  → で送り
          </div>
        </>
      )}
    </div>
  );
}
