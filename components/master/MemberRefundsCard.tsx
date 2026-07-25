"use client";
// ============================================================
// 返金・解約履歴（メンバー詳細画面のカード）
//
//   そのメンバーに紐付いた返金・解約（refunds.member_id = memberId）を表示。
//   区分・ステータスはマスタ名称で解決。累計は「完了扱い」の返金額で集計。
//   ※ 表示専用。登録・進捗更新は返金・解約一覧（/ops/refunds）で行う。
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchMemberRefunds, fetchRefundMasterOptions, formatYen, refundMasterName, doneStatusIds,
} from "../../lib/refunds";
import type { Refund, RefundMaster, RefundKind } from "../../lib/models";

const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 10) : "—");
const KIND_LABEL: Record<RefundKind, string> = { refund: "返金", cancel: "解約", both: "返金＋解約" };

export function MemberRefundsCard({ memberId }: { memberId: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Refund[]>([]);
  const [cat1, setCat1] = useState<RefundMaster[]>([]);
  const [statuses, setStatuses] = useState<RefundMaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMemberRefunds(memberId), fetchRefundMasterOptions()])
      .then(([r, opts]) => { setRows(r); setCat1(opts.cancel_cat1); setStatuses(opts.refund_status); })
      .catch(() => { /* 権限・未マイグレーション時は空表示 */ })
      .finally(() => setLoading(false));
  }, [memberId]);

  const doneIds = doneStatusIds(statuses);
  const total = rows.reduce((s, r) => s + (r.statusId != null && doneIds.has(r.statusId) ? (r.refundAmount || 0) : 0), 0);
  const isDone = (id: number | null) => id != null && doneIds.has(id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm">返金・解約履歴</span>
        <span className="text-[11px] text-gray-400">このメンバーの記録</span>
        <div className="flex-1" />
        <button onClick={() => router.push("/ops/refunds")} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">返金・解約一覧で開く ↗</button>
      </div>
      <div className="px-4 py-2">
        {loading ? <div className="text-center text-gray-300 py-6 text-sm">読み込み中…</div>
          : rows.length === 0 ? <div className="text-center text-gray-300 py-6 text-sm">返金・解約はありません。</div>
          : rows.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-3 py-2.5 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <div className="w-[74px] shrink-0 text-[11px] text-gray-400">{fmt(r.requestedAt)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-gray-800 truncate">{KIND_LABEL[r.kind]} {formatYen(r.refundAmount)}</div>
                <div className="text-[11px] text-gray-400 truncate">{refundMasterName(cat1, r.cancelCat1Id)}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${isDone(r.statusId) ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600"}`}>{refundMasterName(statuses, r.statusId)}</span>
            </div>
          ))}
      </div>
      <div className="flex items-center justify-between px-4 py-3 bg-[#faf9f7] border-t border-gray-100">
        <span className="text-[12px] text-gray-500">返金額 累計（完了）</span>
        <span className="text-[15px] font-bold text-gray-800">{formatYen(total)}</span>
      </div>
    </div>
  );
}
