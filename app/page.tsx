import App from "../app";

// 会員ゾーンのトップ（Phase 2：入り口分離）
//   運営ゾーンは /ops（app/ops/page.tsx）。ガードは middleware.ts。
export default function Page() {
  return <App zone="member" />;
}
