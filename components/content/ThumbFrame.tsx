"use client";
// ============================================================
// サムネイルの表示枠（会員ポータル一覧・詳細・公開ページで共通）
//
//   2つのモードを持つ。
//
//   ① fluid（詳細ヘッダー・公開ページ）
//      枠の比率を固定しない。画像は常に幅100%まで広がり、高さは実比率で決まる。
//      → **左右の余白が構造的に発生しない**（ぼかし帯も暗幕も不要）。
//      縦長画像でヘッダーが間延びしないよう maxHeight で頭打ちにし、
//      はみ出したときだけ下端をフェードさせる（切れたのではなく「続き」に見せる）。
//      ⚠️ カード幅より小さい画像は拡大される＝眠くなる。推奨 1280×720 を守ること。
//
//   ② 固定枠（一覧カード）
//      横並びレイアウトのため枠の高さが要る。16:9 の枠に object-contain で収め、
//      余白は「同じ画像のぼかし＋暗幕」で埋め、本体を角丸＋影で浮かせる。
//
//   参照: lib/contents.ts の THUMB_HINT（推奨 1280×720 / 16:9）
// ============================================================
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export interface ThumbFrameProps {
  src: string;
  /** 詳細ヘッダー用（影を強め、角丸を大きくする） */
  big?: boolean;
  /**
   * 幅100%・高さは画像なり（左右の余白ゼロ）。詳細・公開ページで使う。
   * 未指定なら固定枠モード（呼び出し側が style で aspectRatio を渡す）。
   */
  fluid?: boolean;
  /** fluid のときの高さ上限（px）。超えた分は下端をフェードして隠す。 */
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
  /** 画像が読めなかったとき（呼び出し側で既定サムネに切り替える） */
  onBroken?: () => void;
}

export function ThumbFrame({
  src, big = false, fluid = false, maxHeight = 480, className = "", style, onBroken,
}: ThumbFrameProps) {
  /** 画像の実比率（幅/高さ）。角丸・影を画像の輪郭に一致させるために使う。 */
  const [ratio, setRatio] = useState<number | null>(null);
  /** fluid で高さ上限を超えたか（下端フェードの出し分け） */
  const [clipped, setClipped] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => { setRatio(null); setClipped(false); }, [src]);

  // 幅はレスポンシブで変わるので、リサイズのたびに「はみ出しているか」を測り直す
  useEffect(() => {
    if (!fluid) return;
    const check = () => {
      const el = imgRef.current;
      if (el) setClipped(el.offsetHeight > maxHeight);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [fluid, maxHeight, ratio]);

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    if (el.naturalWidth > 0 && el.naturalHeight > 0) setRatio(el.naturalWidth / el.naturalHeight);
    if (fluid) setClipped(el.offsetHeight > maxHeight);
  };

  // ── ① fluid：幅100%・高さは画像なり（余白ゼロ）──
  if (fluid) {
    return (
      <div className={`relative w-full overflow-hidden bg-gray-100 ${className}`}
        style={{ maxHeight, ...style }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="" onLoad={onLoad} onError={onBroken}
          className="block w-full h-auto" />
        {/* 上限で切れたときだけ、下端を白へフェード（唐突に断ち切られて見えないように） */}
        {clipped && (
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-16 pointer-events-none"
            style={{ background: "linear-gradient(rgba(255,255,255,0), rgba(255,255,255,0.96))" }} />
        )}
      </div>
    );
  }

  // ── ② 固定枠：16:9 に収め、余白はぼかし帯＋暗幕で埋める ──
  const cssUrl = src.replace(/"/g, "%22");
  return (
    <div className={`relative overflow-hidden bg-gray-200 flex items-center justify-center ${className}`} style={style}>
      <div aria-hidden
        className="absolute inset-0 bg-center bg-cover blur-2xl scale-125"
        style={{ backgroundImage: `url("${cssUrl}")` }} />
      {/* 白い画像は「ぼかしても白」で余白と区別できないため、黒を重ねて本体を浮かせる */}
      <div aria-hidden className="absolute inset-0" style={{ background: "rgba(18,20,28,0.38)" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onLoad={onLoad} onError={onBroken}
        className={`relative max-w-full max-h-full object-contain ${
          big
            ? "rounded-xl shadow-[0_6px_20px_rgba(15,18,28,0.30)]"
            : "rounded-md shadow-[0_2px_10px_rgba(15,18,28,0.25)]"
        }`}
        style={ratio ? { aspectRatio: String(ratio) } : undefined} />
    </div>
  );
}
