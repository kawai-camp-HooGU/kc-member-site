"use client";
// ============================================================
// 会員ゾーンの共通レイアウト（固定URL化）
//
//   / ・/content/12 ・/calendar?event=5 … すべてこのレイアウトの下に来る。
//   App をレイアウト側に置くことで、画面を移動しても App が
//   アンマウントされない（＝毎回 fetchAllData が走らない）。
//
//   ⚠️ /login ・/set-password ・/f/[slug] ・/c/[token] はこのグループの外に
//      置いてあるため、このレイアウト（＝サイドバー付きの殻）は付かない。
// ============================================================
import { Suspense } from "react";
import App from "../../app";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <App zone="member" />
      </Suspense>
      {children}
    </>
  );
}
