"use client";
// ============================================================
// useMediaQuery — ビューポート幅で真偽を返すフック（レスポンシブ分岐用）
//
//   「幅で決まる見た目」は原則 Tailwind の接頭辞（md: 等）で解決し、
//   JS でのレイアウト分岐が避けられない箇所だけ本フックを使う。
//
//   ⚠️ SSR / 初回レンダーでは false 固定（＝PC想定）にし、マウント後に実測へ更新する。
//      サーバーとクライアントで初期HTMLを一致させ、hydration mismatch を避けるため。
//      境界値は Tailwind の既定（md=768px）に合わせている。
// ============================================================
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange(); // マウント直後に実測して初期値を補正
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** スマホ相当（< 768px）。Tailwind の md 未満。 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** タブレット相当（768–1023px）。 */
export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}
