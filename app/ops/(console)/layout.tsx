// ============================================================
// 運営ゾーンの共通レイアウト（固定URL化）
//
//   /ops ・/ops/master/event ・/ops/form/3/submissions … すべてここの下。
//
//   ⚠️ Server Component のままにすること（理由は (member)/layout.tsx のコメント参照）。
//   ⚠️ /ops/login ・/ops/members/[id] ・/ops/submissions/[id] はこのグループの外。
//      （単体ページとして開く既存の画面。App の殻を付けない）
// ============================================================
import { Suspense } from "react";
import App from "../../../app";

export const dynamic = "force-dynamic";

export default function OpsConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <App zone="ops" />
      </Suspense>
      {children}
    </>
  );
}
