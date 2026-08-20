"use client";
// ============================================================
// 「画面の下端まで伸ばす」高さを実測で返すフック
//
//   これまでは h-[calc(100dvh-120px)] のように固定値を引いていたが、
//   その 120px はシェル（サイドバー・ヘッダ・main の余白）を変えるたびにずれる。
//   実際にはPCで48px・スマホで105pxしか使っておらず、画面下に無駄な余白が出ていた。
//
//   ここでは要素の実際の上端位置から高さを出すので、シェルを変えても追随する。
//   ⚠️ useLayoutEffect（描画前に確定）なのでちらつかない。
//   ⚠️ SSR では useLayoutEffect が警告になるため useEffect にフォールバックする。
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface FillHeight {
  ref: RefObject<HTMLDivElement>;
  style: CSSProperties;
}

/**
 * @param gap  要素の下に残す余白（px）。main の下パディング相当。
 * @param min  これ以上は縮めない高さ（px）。
 */
export function useFillHeight(gap = 24, min = 360): FillHeight {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const calc = (): void => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setH(Math.max(min, Math.round(window.innerHeight - top - gap)));
    };
    calc();
    window.addEventListener("resize", calc);
    // スマホのキーボード表示で viewport が縮んだときにも追随する
    window.visualViewport?.addEventListener("resize", calc);
    const ro = new ResizeObserver(calc);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", calc);
      window.visualViewport?.removeEventListener("resize", calc);
      ro.disconnect();
    };
  }, [gap, min]);

  return { ref, style: h == null ? { minHeight: min } : { height: h } };
}
