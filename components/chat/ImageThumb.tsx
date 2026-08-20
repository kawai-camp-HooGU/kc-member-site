"use client";
// ============================================================
// 画像添付のサムネイル
//   URLの決め方は3段：
//     ① url        … MessageList が一括発行して配った署名URL（通常はこれ）
//     ② localUrl   … 送信前のローカルファイル（blob URL。署名取得なし）
//     ③ attachment … ①②が無いときだけ自分で署名URLを取りに行く
//   読み込み中はスケルトンで高さを確保する（画像が届いた瞬間に履歴が飛ばないように）。
// ============================================================
import { useEffect, useState } from "react";
import type { ChatAttachment } from "../../lib/models";
import { signedUrls } from "../../lib/chatStorage";

type Status = "loading" | "ok" | "error";

export interface ImageThumbProps {
  /** 解決済みの署名URL（MessageList が一括取得して配る） */
  url?: string;
  /** 送信済み添付。url 未指定時のフォールバックとして自前で署名URLを取る */
  attachment?: ChatAttachment;
  /** 送信前のローカルファイルの blob URL */
  localUrl?: string;
  /** contain＝全体を見せる（1枚時） / cover＝正方形に切り抜く（グリッド時） */
  fit?: "contain" | "cover";
  className?: string;
  /** スケルトン・エラー表示の高さ（px） */
  skeletonHeight?: number;
  onClick?: () => void;
}

export function ImageThumb({
  url, attachment, localUrl, fit = "contain", className, skeletonHeight = 150, onClick,
}: ImageThumbProps) {
  const given = url ?? localUrl ?? null;
  const [src, setSrc] = useState<string | null>(given);
  const [status, setStatus] = useState<Status>(given ? "ok" : "loading");
  const [tick, setTick] = useState(0);   // 「再読み込み」で再取得するためのカウンタ

  useEffect(() => {
    const g = url ?? localUrl ?? null;
    if (g) { setSrc(g); setStatus("ok"); return; }
    if (!attachment) { setStatus("error"); return; }
    let alive = true;
    setStatus("loading");
    const path = attachment.thumbPath ?? attachment.storagePath;
    signedUrls([path])
      .then((m) => {
        if (!alive) return;
        const u = m.get(path);
        if (u) { setSrc(u); setStatus("ok"); } else setStatus("error");
      })
      .catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [url, localUrl, attachment, tick]);

  if (status === "loading") {
    return (
      <div className={`rounded-xl bg-gray-100 animate-pulse grid place-items-center text-[10.5px] text-gray-400 ${className ?? ""}`}
        style={{ height: skeletonHeight }}>
        読み込み中…
      </div>
    );
  }

  if (status === "error" || !src) {
    return (
      <div className={`rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-center ${className ?? ""}`}>
        <div className="text-[11px] font-bold text-gray-600">画像を表示できません</div>
        {attachment && <div className="text-[10.5px] text-gray-400 break-all">{attachment.fileName}</div>}
        <button type="button" onClick={() => setTick((t) => t + 1)}
          className="mt-1 text-[10.5px] font-bold text-red-600 hover:underline">
          再読み込み
        </button>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 署名URL（有効期限つき・外部ドメイン）のため next/image は使えない
    <img
      src={src}
      alt={attachment?.fileName ?? "添付画像"}
      onClick={onClick}
      onError={() => setStatus("error")}
      className={`${fit === "cover" ? "w-full h-full object-cover" : "max-w-full h-auto"} ${onClick ? "cursor-zoom-in" : ""} ${className ?? ""}`}
    />
  );
}
