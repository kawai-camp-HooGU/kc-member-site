"use client";
// ============================================================
// フォーム回答状況（メンバー詳細画面）
//
//   そのメンバーが回答したフォームの一覧。
//   「詳細」を押すと **回答1件の専用詳細画面** /ops/submissions/[id] へ遷移する。
//   （フォーム画面のモーダルではなく、独立した1画面）
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMemberSubmissions, countUnansweredForms } from "../../lib/memberDetail";
import type { MemberSubmission } from "../../lib/memberDetail";
import { SUBMISSION_STATUS_LABEL } from "../../lib/models";
import type { SubmissionStatus } from "../../lib/models";

const STATUS_CLS: Record<SubmissionStatus, string> = {
  new:   "bg-amber-50 text-amber-700 border-amber-200",
  doing: "bg-blue-50 text-blue-700 border-blue-200",
  done:  "bg-emerald-50 text-emerald-700 border-emerald-200",
};

import { fmtJst } from "../../lib/dateFmt";
const fmt = (s: string) => fmtJst(s);

export function MemberFormsCard({ memberId }: { memberId: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<MemberSubmission[]>([]);
  const [unanswered, setUnanswered] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMemberSubmissions(memberId), countUnansweredForms(memberId)])
      .then(([r, n]) => { setRows(r); setUnanswered(n); })
      .catch(() => { /* 権限・未マイグレーション時は空表示 */ })
      .finally(() => setLoading(false));
  }, [memberId]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm">フォーム回答状況</span>
        <span className="text-[11px] text-gray-400">「詳細」で回答詳細画面へ</span>
        <div className="flex-1" />
        <span className="text-[11.5px] text-gray-400">{rows.length} 件</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="tbl-head text-[11px] text-left">
              <th className="px-3 py-2 border-b border-gray-200">フォーム</th>
              <th className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">回答日時</th>
              <th className="px-3 py-2 border-b border-gray-200 whitespace-nowrap">状態</th>
              <th className="px-3 py-2 border-b border-gray-200 w-[70px]" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-[12.5px] text-gray-400">読み込み中...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-[12.5px] text-gray-400">回答したフォームはありません</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
                <td className="px-3 py-2.5">
                  <div className="font-bold text-gray-800 text-[13px]">{r.formName}</div>
                  {r.summary && <div className="text-[11px] text-gray-400 truncate max-w-[260px]">{r.summary}</div>}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-gray-500 whitespace-nowrap">{fmt(r.submittedAt)}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CLS[r.status]}`}>
                    {SUBMISSION_STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button onClick={() => router.push(`/ops/submissions/${r.id}`)}
                    className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 whitespace-nowrap">
                    詳細
                  </button>
                </td>
              </tr>
            ))}
            {!loading && unanswered > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2.5 text-center text-[12px] text-gray-400 bg-gray-50/60">
                  未回答の公開中フォーム：<b className="text-gray-600">{unanswered} 件</b>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
