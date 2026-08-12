import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KAWAI CAMP",
  description: "kawai camp メンバーサイト",
  // アイコンは App Router のファイル規約で自動反映:
  //   app/icon.svg（タブ）／ app/favicon.ico（従来型）／ app/apple-icon.png（iOSホーム追加）
};

// レスポンシブ下地：セーフエリア（env(safe-area-inset-*)）を有効化する。
//   viewportFit: "cover" でノッチ端末でも画面全体を使い、余白は CSS 側で吸収する。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
