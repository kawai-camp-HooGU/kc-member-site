// ============================================================
// 返金・解約マスタ（/ops/refundmaster）
//   App シェル（サイドバー＋メイン）を描画し、中身は app.tsx の
//   view 分岐（view="refundmaster" → RefundMasterView）が担う。
//   ⚠️ Server Component のままにすること（App は client）。
// ============================================================
import App from "../../../app";

export const dynamic = "force-dynamic";

export default function OpsRefundMasterPage() {
  return <App zone="ops" />;
}
