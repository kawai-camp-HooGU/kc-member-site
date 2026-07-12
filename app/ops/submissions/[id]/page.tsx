"use client";
// ============================================================
// 回答詳細（1件・専用画面）
//   /ops/submissions/[id]
//
//   メンバー詳細の「フォーム回答状況 → 詳細」から遷移する。
//   運営ゾーン配下なので、会員ロールは middleware が / へ追い出す。
// ============================================================
import { useParams } from "next/navigation";
import { SubmissionDetailView } from "../../../../views/SubmissionDetailView";
import { ToastProvider } from "../../../../components/common/ToastProvider";

export default function OpsSubmissionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  if (!Number.isFinite(id)) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">回答IDが不正です。</div>;
  }

  return (
    <ToastProvider>
      <SubmissionDetailView submissionId={id} />
    </ToastProvider>
  );
}
