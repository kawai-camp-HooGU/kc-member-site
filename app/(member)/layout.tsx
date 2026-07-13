// ============================================================
// 会員ゾーンの共通レイアウト（固定URL化）
//
//   / ・/content/12 ・/calendar?event=5 … すべてこのレイアウトの下に来る。
//   App をレイアウト側に置くことで、画面を移動しても App が
//   アンマウントされない（＝毎回 fetchAllData が走らない）。
//
//   ⚠️ ここは Server Component のままにすること（"use client" を付けない）。
//      App は useSearchParams() を使うため、
//        ・静的プリレンダリングを止める  → export const dynamic = "force-dynamic"
//        ・Suspense 境界を親に置く       → <Suspense> で包む
//      の2つが必要で、どちらも Server Component 側でしか効かない。
//      （"use client" を付けると build 時に
//        「useSearchParams() should be wrapped in a suspense boundary」で落ちる）
//
//   ⚠️ /login ・/set-password ・/f/[slug] ・/c/[token] はこのグループの外に
//      置いてあるため、このレイアウト（＝サイドバー付きの殻）は付かない。
// ============================================================
import { Suspense } from "react";
import App from "../../app";

export const dynamic = "force-dynamic";

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
