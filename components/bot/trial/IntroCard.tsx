"use client";
// ============================================================
// ①体験の説明カード
//   ・押せるボタンは「はじめる」1つを主役にする（やさしさ）。
//   ・テンプレプロンプトの中身は見せない（見せると「難しそう」になる）。
// ============================================================
import { IcArrowUp } from "../icons";
import type { TrialScenarioPublic } from "../../../lib/bot/trial/types";

export function IntroCard({
  scenario, busy, onStart,
}: {
  scenario: TrialScenarioPublic;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <div className="bg-[#161513] border border-[#37342f] rounded-xl p-4">
      <div className="text-sm font-bold text-[#f3efe8] mb-1">{scenario.title}</div>
      <p className="text-xs text-[#a8a196] leading-relaxed whitespace-pre-wrap mb-3">
        {scenario.intro}
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="inline-flex items-center gap-1.5 bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110 disabled:opacity-40"
      >
        <IcArrowUp className="w-4 h-4" />
        {busy ? "準備中…" : scenario.ctaLabel}
      </button>
      <div className="text-[10.5px] text-[#5a564e] mt-2.5 leading-relaxed">
        体験中でも、下の入力欄からふつうの質問ができます。
      </div>
    </div>
  );
}
