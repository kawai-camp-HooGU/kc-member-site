"use client";
// ============================================================
// 添付の並べ方
//   画像はサムネイル、それ以外は従来のファイルカード。
//   画像が先・ファイルが後。枚数によるレイアウト分岐はここに閉じる。
//     1枚      … 元の縦横比のまま（幅236px・高さ280pxに収める）
//     2枚      … 正方形に切り抜いて横2分割
//     3〜4枚   … 2×2
//     5枚以上  … 2×2＋最後のマスに「+N」
// ============================================================
import type { ChatAttachment } from "../../lib/models";
import { isImageAttachment } from "../../lib/attachments";
import { ImageThumb } from "./ImageThumb";
import { FileCard } from "./FileCard";

export interface AttachmentGridProps {
  attachments: ChatAttachment[];
  /** 青塗りの吹き出しの上か（FileCard の配色に渡す） */
  painted: boolean;
  /** 解決済みの署名URL（storagePath / thumbPath → URL） */
  urls?: Map<string, string>;
  /** 画像クリック時。同一メッセージの画像配列と開始位置を渡す */
  onOpenImage?: (images: ChatAttachment[], index: number) => void;
}

const GRID_MAX = 4;

export function AttachmentGrid({ attachments, painted, urls, onOpenImage }: AttachmentGridProps) {
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));
  const urlOf = (a: ChatAttachment): string | undefined =>
    urls?.get(a.thumbPath ?? a.storagePath);

  const cells = images.slice(0, GRID_MAX);
  const rest = images.length - cells.length;

  return (
    <>
      {images.length === 1 && images[0] && (
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-white w-[236px] max-w-full">
          <ImageThumb attachment={images[0]} url={urlOf(images[0])} fit="contain"
            className="max-h-[280px] object-contain"
            onClick={onOpenImage ? () => onOpenImage(images, 0) : undefined} />
        </div>
      )}

      {images.length > 1 && (
        <div className="grid grid-cols-2 gap-[3px] w-[236px] max-w-full">
          {cells.map((a, i) => {
            const isLast = i === GRID_MAX - 1 && rest > 0;
            return (
              <div key={a.id} className="relative aspect-square overflow-hidden rounded-lg bg-gray-200">
                <ImageThumb attachment={a} url={urlOf(a)} fit="cover" skeletonHeight={112}
                  onClick={onOpenImage ? () => onOpenImage(images, i) : undefined} />
                {isLast && (
                  <button type="button"
                    onClick={onOpenImage ? () => onOpenImage(images, GRID_MAX - 1) : undefined}
                    className="absolute inset-0 bg-black/55 text-white text-base font-extrabold grid place-items-center">
                    +{rest}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {files.map((a, i) => (
        <div key={a.id} className={i === 0 && images.length === 0 ? "" : "mt-2"}>
          <FileCard attachment={a} out={painted} />
        </div>
      ))}
    </>
  );
}
