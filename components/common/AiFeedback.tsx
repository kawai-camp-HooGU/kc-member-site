"use client";
// ============================================================
// 回答への評価（A-8）
//   「役に立った／役に立たなかった」＋ 悪いときの理由。
//   ・押せるのは1回答につき1回（押し直しは上書き）。
//   ・理由は選択肢のみ。自由記述にすると個人情報が混ざり、集計もできない。
//   ・失敗しても本文の表示は壊さない（静かに諦める）。
//
//   ⚠️ brand.md：絵文字は使わない。👍/👎 ではなく言葉で出す。
//   ⚠️ 公開ボットは暗い地なので tone="dark" で色を差し替える。
// ============================================================
import { useState } from "react";
import { aiFeedback } from "../../lib/aiClient";
import { FEEDBACK_REASONS } from "../../lib/ai/types";

export interface AiFeedbackProps {
  traceId: number;
  shareToken?: string | null;
  tone?: "light" | "dark";
}

const CLS = {
  light: {
    label: "text-gray-400",
    btn: "border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
    on: "border-gray-800 bg-gray-800 text-white",
    reason: "border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
    done: "text-gray-500",
  },
  dark: {
    label: "text-[#736e66]",
    btn: "border-[#37342f] bg-transparent text-[#a8a196] hover:border-[#544f48]",
    on: "border-[#a8a196] bg-[#2b2926] text-[#f3efe8]",
    reason: "border-[#37342f] bg-transparent text-[#a8a196] hover:border-[#544f48]",
    done: "text-[#736e66]",
  },
} as const;

export function AiFeedback({ traceId, shareToken = null, tone = "light" }: AiFeedbackProps) {
  const c = CLS[tone];
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (r: 1 | -1, reason?: string) => {
    if (busy) return;
    setBusy(true);
    setRating(r);
    try {
      await aiFeedback({ traceId, rating: r, reason, shareToken });
      if (r === 1 || reason) { setDone(true); setAskReason(false); }
      else setAskReason(true);
    } catch {
      // 評価が送れなくても会話は続けられるべきなので、黙って諦める
      setDone(true);
      setAskReason(false);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <div className={`text-[10.5px] mt-1.5 ${c.done}`}>ご意見ありがとうございます。</div>;
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10.5px] ${c.label}`}>この回答は役に立ちましたか</span>
        <button type="button" disabled={busy} onClick={() => void send(1)}
          className={`text-[10.5px] font-bold rounded-full border px-2.5 py-0.5 disabled:opacity-50 ${rating === 1 ? c.on : c.btn}`}>
          役に立った
        </button>
        <button type="button" disabled={busy} onClick={() => void send(-1)}
          className={`text-[10.5px] font-bold rounded-full border px-2.5 py-0.5 disabled:opacity-50 ${rating === -1 ? c.on : c.btn}`}>
          役に立たなかった
        </button>
      </div>

      {askReason && (
        <div className="mt-1.5">
          <div className={`text-[10.5px] mb-1 ${c.label}`}>差し支えなければ、理由を教えてください</div>
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <button key={r.key} type="button" disabled={busy}
                onClick={() => void send(-1, r.key)}
                className={`text-[10.5px] rounded-full border px-2.5 py-0.5 disabled:opacity-50 ${c.reason}`}>
                {r.label}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => setDone(true)}
              className={`text-[10.5px] px-1.5 py-0.5 ${c.done}`}>
              答えない
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
