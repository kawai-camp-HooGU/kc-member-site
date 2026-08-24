"use client";
// ============================================================
// ⑤ 配信前チェック（一斉配信）
//   本文と配信先を渡して AI に確認させ、level 別に並べる。
//   ・warn が残っているあいだは、呼び出し側で送信ボタンを止める（誤爆防止）。
//   ・本文か配信先を編集したら結果は破棄する（呼び出し側の責務）。
//     古い「問題なし」で新しい本文を送れてしまうと、チェックの意味が無くなるため。
//
//   ⚠️ 配色について
//     設計書のモックは warn＝赤だが、brand.md §1-2「red-* はアクセントであって危険色ではない」
//     に従い、警告は琥珀（要確認と同じ）で出す。この画面は送信ボタンが赤なので、
//     警告まで赤にすると「押すもの」と「止めるもの」が同じ色になってしまう。
// ============================================================
import { aiBroadcastCheck } from "../../lib/aiClient";
import type { BcTarget, BcWarning } from "../../lib/ai/types";
import { SUCCESS_CONFIG } from "../../lib/constants";

export interface AiBroadcastCheckProps {
  target: BcTarget;
  messageBody: string;
  /** null＝未実行 */
  checks: BcWarning[] | null;
  running: boolean;
  onStart: () => void;
  onDone: (checks: BcWarning[]) => void;
  onError: (message: string) => void;
  /** 見出しやボタンを小さくする（確認モーダルの中で使う） */
  compact?: boolean;
}

/** warn の件数。呼び出し側の送信ガードもこの関数で判定する。 */
export const warnCount = (checks: BcWarning[] | null): number =>
  (checks ?? []).filter((c) => c.level === "warn").length;

const LEVEL_CLS: Record<BcWarning["level"], string> = {
  warn: "bg-amber-50 border-amber-200 text-amber-800",
  ok: `${SUCCESS_CONFIG.bg} ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.text}`,
  info: "bg-gray-50 border-gray-200 text-gray-600",
};
const LEVEL_LABEL: Record<BcWarning["level"], string> = {
  warn: "要確認", ok: "問題なし", info: "参考",
};

export function AiBroadcastCheck(p: AiBroadcastCheckProps) {
  const run = async () => {
    const body = (p.messageBody ?? "").trim();
    if (!body) { p.onError("本文を入力してからチェックしてください"); return; }
    p.onStart();
    try {
      const res = await aiBroadcastCheck({ messageBody: body, target: p.target });
      p.onDone(res.checks ?? []);
    } catch (e) {
      p.onError((e as Error).message);
    }
  };

  const warns = warnCount(p.checks);

  return (
    <div className="border border-gray-200 bg-white rounded-xl p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className={`font-extrabold text-gray-800 ${p.compact ? "text-[11px]" : "text-[12px]"}`}>配信前チェック</span>
          <span className="block text-[10.5px] text-gray-400 mt-0.5">
            {p.checks === null
              ? "本文と配信先をAIが確認します。送信前に一度実行してください。"
              : warns > 0
                ? `要確認が ${warns} 件あります。内容を見てから送信してください。`
                : "指摘はありませんでした。"}
          </span>
        </div>
        <button type="button" onClick={() => void run()} disabled={p.running}
          className="shrink-0 text-[12px] font-bold px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {p.running ? "確認中…" : p.checks === null ? "チェックを実行" : "もう一度チェック"}
        </button>
      </div>

      {p.running && <div className="text-[11.5px] text-gray-400 py-2">…</div>}

      {!p.running && p.checks !== null && (
        p.checks.length === 0 ? (
          <div className={`text-[11.5px] rounded-lg border px-3 py-2 ${LEVEL_CLS.ok}`}>指摘はありませんでした。</div>
        ) : (
          <ul className="space-y-1.5">
            {/* warn を先に出す。下にスクロールしないと危険が見えない状態を作らない */}
            {[...p.checks].sort((a, b) => (a.level === "warn" ? -1 : 0) - (b.level === "warn" ? -1 : 0)).map((c, i) => (
              <li key={i} className={`text-[11.5px] leading-relaxed rounded-lg border px-3 py-2 ${LEVEL_CLS[c.level]}`}>
                <b className="mr-1.5">{LEVEL_LABEL[c.level]}</b>{c.message}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
