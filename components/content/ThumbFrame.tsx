"use client";
// ============================================================
// サムネイルの表示枠（会員ポータル一覧・詳細・公開ページで共通）
//
//   【表示ルール】
//     ・枠は 16:9 固定（呼び出し側が style で指定）
//     ・画像は object-contain。切り抜かない＝端が切れない
//     ・余白（レターボックス）は同じ画像をぼかして敷き、その上に
//       画像本体を「角丸＋影」で乗せる。帯と本体の境界がはっきりするので、
//       白い画像でも余白に見えない。
//
//   ⚠️ 角丸・影は <img> 要素そのものに掛ける必要がある。
//      object-contain のままだと要素の矩形＝枠全体なので、角丸が枠に付いてしまい
//      画像には掛からない。そこで onLoad で実比率を測り、aspect-ratio として
//      与えることで「要素の矩形＝画像の矩形」に一致させている。
//
//   参照: lib/contents.ts の THUMB_HINT（推奨 1280×720 / 16:9）
// ============================================================
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export interface ThumbFrameProps {
  src: string;
  /** 詳細ヘッダー用（影を強め、角丸を大きくする） */
  big?: boolean;
  className?: string;
  style?: CSSProperties;
  /** 画像が読めなかったとき（呼び出し側で既定サムネに切り替える） */
  onBroken?: () => void;
}

export function ThumbFrame({ src, big = false, className = "", style, onBroken }: ThumbFrameProps) {
  /** 画像の実比率（幅/高さ）。読み込むまでは未定。 */
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => { setRatio(null); }, [src]);

  const cssUrl = src.replace(/"/g, "%22");

  return (
    <div className={`relative overflow-hidden bg-gray-200 flex items-center justify-center ${className}`} style={style}>
      {/* 余白埋め：同じ画像をぼかして敷く。opacity は掛けない（下地と混ざって白く飛ぶため）。 */}
      <div aria-hidden
        className="absolute inset-0 bg-center bg-cover blur-2xl scale-125"
        style={{ backgroundImage: `url("${cssUrl}")` }} />

      {/* 暗幕：白い画像は「ぼかしても白」で余白と区別できない。
          帯の上に黒を重ねることで、画像の色に関係なく必ず本体が浮き上がる。 */}
      <div aria-hidden className="absolute inset-0" style={{ background: "rgba(18,20,28,0.38)" }} />

      {/* 画像本体：帯の上に乗っているように見せる */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth > 0 && el.naturalHeight > 0) setRatio(el.naturalWidth / el.naturalHeight);
        }}
        onError={onBroken}
        className={`relative max-w-full max-h-full object-contain ${
          big
            ? "rounded-xl shadow-[0_6px_20px_rgba(15,18,28,0.30)]"
            : "rounded-md shadow-[0_2px_10px_rgba(15,18,28,0.25)]"
        }`}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
      />
    </div>
  );
}
