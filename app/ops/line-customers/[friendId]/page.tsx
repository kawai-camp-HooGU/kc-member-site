"use client";
// ============================================================
// LINE顧客 詳細（1画面・別ウィンドウで開く）
//   /ops/line-customers/[friendId]
//
//   会員詳細（/ops/members/[id]）と同じ「別ウィンドウ1画面」方式。
//   運営ゾーン配下なので、会員ロールは middleware が追い出す。
//   app.tsx を経由しないため、データは LineCustomerDetailView が単体取得する。
// ============================================================
import { useParams } from "next/navigation";
import { LineCustomerDetailView } from "../../../../views/LineCustomerDetailView";
import { ToastProvider } from "../../../../components/common/ToastProvider";

export default function OpsLineCustomerDetailPage() {
  const params = useParams<{ friendId: string }>();
  const id = Number(params?.friendId);

  if (!Number.isFinite(id)) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">IDが不正です。</div>;
  }

  return (
    <ToastProvider>
      <LineCustomerDetailView friendId={id} />
    </ToastProvider>
  );
}
