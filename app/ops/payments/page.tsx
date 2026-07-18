// ============================================================
// 決済（/ops/payments）
//   App シェル（サイドバー＋メイン）を描画し、中身は app.tsx の
//   view 分岐（view="payments" → PaymentView）が担う。
//   ⚠️ 以前は app.tsx を経由しない独立ページだったためサイドバーが出なかった。
//      他画面と統一するため (console)/layout.tsx と同じく <App zone="ops" /> を描画する。
//   ⚠️ Server Component のままにすること（App は client）。
// ============================================================
import App from "../../../app";

export const dynamic = "force-dynamic";

export default function OpsPaymentsPage() {
  return <App zone="ops" />;
}
