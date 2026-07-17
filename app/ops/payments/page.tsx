"use client";
// ============================================================
// 決済情報管理（独立ルート）
//   /ops/payments
//
//   運営ゾーン配下なので、会員ロールは middleware が / へ追い出す。
//   app.tsx を経由しないため、必要なプロバイダはここで用意する。
// ============================================================
import { PaymentView } from "../../../components/payment/PaymentView";
import { ToastProvider } from "../../../components/common/ToastProvider";
import { ConfirmProvider } from "../../../components/common/ConfirmProvider";

export default function OpsPaymentsPage() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          <PaymentView />
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
