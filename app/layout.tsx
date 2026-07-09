import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KAWAI CAMP",
  description: "kawai camp メンバーサイト",
  icons: { icon: "/logo-icon.png", shortcut: "/logo-icon.png", apple: "/logo-icon.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
