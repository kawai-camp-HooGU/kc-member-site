// ============================================================
// 返金・解約（/ops/refunds）
//   App シェル（サイドバー＋メイン）を描画し、中身は app.tsx の
//   view 分岐（view="refunds" → RefundView）が担う。決済ページと同型。
//   ⚠️ Server Component のままにすること（App は client）。
// ============================================================
import App from "../../../app";

export const dynamic = "force-dynamic";

export default function OpsRefundsPage() {
  return <App zone="ops" />;
}
