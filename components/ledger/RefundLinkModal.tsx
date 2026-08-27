"use client";
// ============================================================
// 返金の会員照合モーダル（売上経費一覧から開く）
//
//   返金・解約の入力は会員詳細に移した（REQ-036）。そのため
//   member_id が付いていない返金は、どの会員の画面にも現れず編集できなくなる。
//   ここがその退避導線（確認事項2a）：一覧の返金行から会員を探して紐付け、
//   紐付いたら会員詳細を開いて続きを編集する。
//
//   ※ 会員を作る画面ではない。既にいる会員に結び直すだけ。
// ============================================================
import { useState } from "react";
import {
  matchMemberByEmail, findMemberCandidates, formatYen, saveRefund,
  type MemberLite,
} from "../../lib/refunds";
import type { Refund } from "../../lib/models";
import { errMessage } from "../../lib/errors";
import { FIELD_INPUT } from "../../lib/constants";
import { useToast } from "../common/ToastProvider";

export function RefundLinkModal({
  refund, onClose, onLinked,
}: {
  refund: Refund;
  onClose: () => void;
  /** 紐付けに成功したときに呼ぶ（一覧の再読込と会員詳細への遷移は呼び出し元の責任） */
  onLinked: (memberId: number) => void;
}) {
  const toast = useToast();
  const [kw, setKw] = useState("");
  const [cand, setCand] = useState<MemberLite[]>([]);
  const [busy, setBusy] = useState(false);

  const search = async (k: string) => {
    setKw(k);
    try { setCand(k.trim() ? await findMemberCandidates(k) : []); }
    catch { setCand([]); }
  };

  const tryEmail = async () => {
    const email = refund.customerEmail || refund.applicantEmail;
    if (!email) { toast.error("この返金にメールアドレスがありません。氏名で検索してください"); return; }
    try {
      const m = await matchMemberByEmail(email);
      if (m) { await link(m); return; }
      toast.error("メール一致する会員が見つかりませんでした（氏名で検索してください）");
    } catch (e) { toast.error(errMessage(e, "照合に失敗しました")); }
  };

  const link = async (m: MemberLite) => {
    setBusy(true);
    const res = await saveRefund({
      ...refund,
      memberId: m.id,
      customerName: m.name || refund.customerName,
      customerEmail: m.email || refund.customerEmail,
    });
    setBusy(false);
    if (res.id == null) { toast.error(`紐付けに失敗しました：${res.error}`); return; }
    toast.success(`${m.name} さんに紐付けました`);
    onLinked(m.id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-lg shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <h2 className="font-bold text-gray-800 text-sm">返金を会員に紐付ける</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg bg-[#faf9f7] border border-gray-200 px-3 py-2.5">
            <div className="text-[12.5px] font-bold text-gray-800">
              {refund.customerName || refund.applicantName || "（氏名なし）"}　{formatYen(refund.refundAmount)}
            </div>
            <div className="text-[11px] text-gray-500">
              受付 {refund.requestedAt ? refund.requestedAt.replace("T", " ") : "—"}
              {(refund.customerEmail || refund.applicantEmail) && ` ／ ${refund.customerEmail || refund.applicantEmail}`}
            </div>
          </div>

          <p className="text-[11.5px] text-gray-500">
            この返金はまだ会員に紐付いていません。会員を選ぶと、その方の <span className="font-bold">会員詳細 ＞ 返金・解約</span> で編集できるようになります。
          </p>

          <div className="flex gap-2">
            <button onClick={() => void tryEmail()} disabled={busy}
              className="text-[11.5px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-2 hover:bg-gray-50 whitespace-nowrap disabled:opacity-50">
              メールで照合
            </button>
            <input className={`${FIELD_INPUT} flex-1`} value={kw} placeholder="氏名・メールで会員を検索"
              onChange={(e) => void search(e.target.value)} />
          </div>

          {cand.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              {cand.map((m) => (
                <button key={m.id} disabled={busy} onClick={() => void link(m)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0 disabled:opacity-50">
                  <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 grid place-items-center text-[11px] font-bold shrink-0">
                    {(m.name || "?").slice(0, 1)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[12.5px] font-bold text-gray-800 block truncate">{m.name}</span>
                    <span className="text-[11px] text-gray-400 block truncate">{m.email} ・ {m.company}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {kw.trim() && cand.length === 0 && (
            <p className="text-[11.5px] text-gray-400">該当する会員が見つかりません。条件を短くして試してください。</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">閉じる</button>
        </div>
      </div>
    </div>
  );
}
