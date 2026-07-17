"use client";
// ============================================================
// 決済履歴（メンバー詳細画面のカード）
//
//   そのメンバーに照合された決済（payments.member_id = memberId）を表示。
//   商品種別・サイト・方法はマスタ名称で解決（DBは番号参照）。
//   累計は「売上計上額」で集計。詳細は決済一覧（/ops/payments）で開く。
//   ※ 表示専用。登録・編集は決済一覧側で行う。
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMemberPayments, fetchMasterOptions, formatYen, nameOf } from "../../lib/payments";
import type { Payment, PaymentMaster } from "../../lib/models";

const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 10) : "—");

export function MemberPaymentsCard({ memberId }: { memberId: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Payment[]>([]);
  const [types, setTypes] = useState<PaymentMaster[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);
  const [methods, setMethods] = useState<PaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMemberPayments(memberId), fetchMasterOptions()])
      .then(([r, m]) => { setRows(r); setTypes(m.types); setSites(m.sites); setMethods(m.methods); })
      .catch(() => { /* 権限・未マイグレーション時は空表示 */ })
      .finally(() => setLoading(false));
  }, [memberId]);

  const total = rows.reduce((s, p) => s + (p.recognizedAmount || 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm">決済履歴</span>
        <span className="text-[11px] text-gray-400">照合済みの決済を表示</span>
        <div className="flex-1" />
        <button onClick={() => router.push("/ops/payments")} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">決済一覧で開く ↗</button>
      </div>

      <div className="divide-y divide-gray-100">
        {loading && <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">読み込み中...</div>}
        {!loading && rows.length === 0 && <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">この会員に照合された決済はありません</div>}
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="w-[54px] shrink-0 text-[11px] text-gray-400">{fmt(p.paidAt)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-gray-800 truncate">{nameOf(types, p.typeId)}</div>
              <div className="text-[11px] text-gray-400 truncate">{nameOf(sites, p.siteId)} / {nameOf(methods, p.methodId)}　計上 {formatYen(p.recognizedAmount)}</div>
            </div>
            <div className="text-[13px] font-bold text-gray-800 shrink-0 tabular-nums">{formatYen(p.amount)}</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#faf9f7] border-t border-gray-100">
          <span className="text-[12px] text-gray-500">累計 売上計上額（{rows.length}件）</span>
          <span className="text-[15px] font-bold text-gray-800 tabular-nums">{formatYen(total)}</span>
        </div>
      )}
    </div>
  );
}
