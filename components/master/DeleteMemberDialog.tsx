"use client";
// ============================================================
// メンバー削除ダイアログ（利用停止 / 完全削除の2択）
//
//   「削除」は一つではない。運営が意図しているのはたいてい
//   「もうログインさせたくない」であって「分析データを消したい」ではないため、
//   既定は **利用停止（履歴を残す）** にしてある。
//
//   完全削除は取り消せないので、
//     ① 実データの影響件数を出す（チャット◯件・回答◯件…）
//     ② チェックボックスで明示的に同意させる
//   の2段階を挟む。
//
//   実処理は lib/memberDetail.ts → /api/members/delete（service_role）。
// ============================================================
import { useEffect, useState } from "react";
import { fetchDeleteImpact, deleteMember } from "../../lib/memberDetail";
import type { DeleteImpact, DeleteMode } from "../../lib/memberDetail";
import { Icon } from "../common/Icon";

interface Props {
  memberId: number;
  memberName: string;
  onCancel: () => void;
  /** 削除完了（呼び出し側で画面を閉じる） */
  onDone: (mode: DeleteMode) => void;
  onError: (msg: string) => void;
}

export function DeleteMemberDialog({ memberId, memberName, onCancel, onDone, onError }: Props) {
  const [mode, setMode] = useState<DeleteMode>("deactivate");
  const [agreed, setAgreed] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchDeleteImpact(memberId).then(setImpact); }, [memberId]);

  const run = async () => {
    if (busy || (mode === "purge" && !agreed)) return;
    setBusy(true);
    const err = await deleteMember(memberId, mode);
    setBusy(false);
    if (err) { onError(err); return; }
    onDone(mode);
  };

  const counts = impact
    ? [
        ["チャット", impact.chats],
        ["フォーム回答", impact.submissions],
        ["属性", impact.attributes],
        ["視聴ログ", impact.views],
      ] as const
    : [];

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-[15px] font-bold text-gray-800">「{memberName}」を削除</p>
          <p className="text-xs text-gray-400 mt-0.5">削除の方法を選んでください</p>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {/* ── 利用停止（既定）── */}
          <label className={`flex gap-2.5 p-3 rounded-xl cursor-pointer border-2 ${
            mode === "deactivate" ? "border-blue-500 bg-blue-50/60" : "border-gray-200 bg-white"}`}>
            <input type="radio" name="delmode" className="mt-1 w-4 h-4 accent-blue-600"
              checked={mode === "deactivate"} onChange={() => setMode("deactivate")} />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-blue-800">
                <Icon name="lock" size={15} /> 利用停止（履歴を残す）
              </span>
              <span className="block text-[12px] text-blue-900/80 mt-1.5 leading-relaxed">
                ログインアカウントだけを削除します。<br />
                ・ログインできなくなる（同じメールで再招待は可能）<br />
                ・一覧から消えるが、チャット・フォーム回答・属性・視聴ログは残る<br />
                ・流入経路の分析に影響しない
              </span>
            </span>
          </label>

          {/* ── 完全削除 ── */}
          <label className={`flex gap-2.5 p-3 rounded-xl cursor-pointer border-2 ${
            mode === "purge" ? "border-red-500 bg-red-50/60" : "border-gray-200 bg-white"}`}>
            <input type="radio" name="delmode" className="mt-1 w-4 h-4 accent-red-600"
              checked={mode === "purge"} onChange={() => setMode("purge")} />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-red-700">
                <Icon name="trash" size={15} /> 完全削除（すべて消す）
              </span>
              <span className="block text-[12px] text-gray-600 mt-1.5 leading-relaxed">
                会員データそのものを DB から削除します。<br />
                ・ログインアカウントも削除<br />
                ・チャット・属性・視聴ログ・シナリオ登録も<b className="font-bold">連鎖削除</b><br />
                ・フォーム回答は匿名の回答として残る<br />
                ・<b className="font-bold text-red-600">復元できません</b>
              </span>
            </span>
          </label>

          {/* ── 完全削除のときだけ、実データの影響件数＋同意 ── */}
          {mode === "purge" && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
              <label className="flex gap-2 items-start cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-red-600"
                  checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span className="text-[12px] text-red-800 leading-relaxed">
                  {impact
                    ? `${counts.filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n} 件`).join("・") || "関連データなし"}${
                        counts.some(([, n]) => n > 0) ? "が影響を受ける" : ""
                      }ことを理解しました`
                    : "影響範囲を確認中…"}
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 justify-end px-5 py-4 border-t border-gray-100">
          <button onClick={onCancel} disabled={busy}
            className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
            キャンセル
          </button>
          <button onClick={run} disabled={busy || (mode === "purge" && !agreed)}
            className={`px-6 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === "purge" ? "bg-red-700 hover:bg-red-800" : "bg-red-600 hover:bg-red-700"}`}>
            {busy ? "処理中..." : mode === "purge" ? "完全に削除する" : "利用停止する"}
          </button>
        </div>
      </div>
    </div>
  );
}
