import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KAWAI CAMP",
  description: "kawai camp メンバーサイト",
  // アイコンは App Router のファイル規約で自動反映:
  //   app/icon.svg（タブ）／ app/favicon.ico（従来型）／ app/apple-icon.png（iOSホーム追加）
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
