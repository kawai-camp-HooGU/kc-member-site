"use client";
// ============================================================
// 顧客詳細：統合（名寄せ）の更新履歴
//   会員(親)へ LINE(子)の不足分を補完した差分を、項目単位で時系列表示する。
//   何が・どの値で・どのソースから・誰が を確認できる。
// ============================================================
import { useEffect, useState } from "react";
import type { CustomerMergeHistory } from "../../lib/models";
import { fetchMergeHistory, MERGE_FIELD_LABEL } from "../../lib/customers";
import { fmtDateTime } from "../../lib/engagement";

const card = "bg-white border border-gray-200 rounded-xl";

const fieldLabel = (f: string): string =>
  (MERGE_FIELD_LABEL as Record<string, string>)[f] ?? f;

const matchedLabel = (m: string): string =>
  m === "email" ? "メール一致" : m === "phone" ? "電話一致" : m === "manual" ? "手動" : m === "auto" ? "自動" : m;

export function MemberMergeHistoryCard({ memberId }: { memberId: number }) {
  const [rows, setRows]       = useState<CustomerMergeHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMergeHistory(memberId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [memberId]);

  if (loading) return null;
  if (rows.length === 0) return null;   // 統合履歴が無ければカードごと出さない

  return (
    <div className={card}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="font-bold text-sm">統合履歴</span>
        <span className="text-[11px] text-gray-400">名寄せで会員へ補完された項目（時系列）</span>
      </div>
      <div className="p-4 space-y-3">
        {rows.map((h) => (
          <div key={h.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 border ${
                h.action === "unmerge"
                  ? "bg-gray-100 text-gray-500 border-gray-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                {h.action === "unmerge" ? "統合解除" : "統合"}
              </span>
              <span className="text-[11.5px] font-bold text-gray-700">{fieldLabel(h.field)}</span>
              {h.matchedBy && <span className="text-[10.5px] text-gray-400">／ {matchedLabel(h.matchedBy)}</span>}
              <span className="ml-auto text-[10.5px] text-gray-400">{fmtDateTime(h.createdAt)}</span>
            </div>
            <div className="text-[12px] text-gray-600">
              <span className="text-gray-400">{h.oldValue || "（空）"}</span>
              <span className="mx-1.5 text-gray-400">→</span>
              <b className="text-gray-800">{h.newValue || "（空）"}</b>
              <span className="ml-2 text-[10.5px] text-gray-400">source: {h.sourceKind}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
