"use client";
// ============================================================
// メンバー詳細（1画面・別ウィンドウで開く）
//   /ops/members/[id]
//
//   運営ゾーン配下なので、会員ロールは middleware が / へ追い出す。
//   （画面側の判定に頼らない＝サーバー側で必ず止める）
//
//   ⚠️ app.tsx を経由しないため MasterContext が無い。
//      必要なデータは MemberDetailView が lib/memberDetail.ts で単体取得する。
// ============================================================
import { useParams } from "next/navigation";
import { MemberDetailView } from "../../../../views/MemberDetailView";
import { ToastProvider } from "../../../../components/common/ToastProvider";

export default function OpsMemberDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  if (!Number.isFinite(id)) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">メンバーIDが不正です。</div>;
  }

  return (
    <ToastProvider>
      <MemberDetailView memberId={id} />
    </ToastProvider>
  );
}
