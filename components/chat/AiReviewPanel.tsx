"use client";
// ============================================================
// ③ メッセージ添削（送信前の最後の関門）
//   ・critical（リスク表現）/ warning（敬語・誤字）/ suggest（トーン）
//   ・差分は文単位で表示（AIが勝手に足した文言をオペが即座に発見できる）
//   ・反映先は必ず入力欄。送信はしない。
// ============================================================
import { useMemo, useState } from "react";
import { aiReview } from "../../lib/aiClient";
import { openAiChat } from "../../lib/aiChat";
import { errMessage } from "../../lib/errors";
import { REVIEW_ASPECTS } from "../../lib/ai/types";
import type { ReviewAspect, ReviewIssue, ReviewRes } from "../../lib/ai/types";

export interface AiReviewPanelProps {
  /** 添削対象（Composer の現在値） */
  draft: string;
  conversationId: number | null;
  /** 修正後を入力欄へ反映 */
  onApply: (text: string) => void;
}

const SEV_STYLE: Record<string, { label: string; box: string; tag: string }> = {
  critical: { label: "要修正", box: "border-l-2 border-red-500 bg-red-50/60", tag: "text-red-700" },
  warning: { label: "注意", box: "border-l-2 border-amber-500 bg-amber-50/60", tag: "text-amber-700" },
  suggest: { label: "提案", box: "border-l-2 border-gray-300 bg-gray-50", tag: "text-gray-600" },
};

/**
 * 文単位に分割（句点・改行で切る。区切り文字は前の文に含める）。
 * 後読み(?<=)は一部の古いブラウザで動かないため使わない。
 */
function sentences(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (ch === "\n") {
      if (cur.trim()) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
    if ("。！？!?".includes(ch)) {
      if (cur.trim()) out.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

interface DiffPart { type: "same" | "del" | "ins"; text: string }

function diffSentences(before: string, after: string): DiffPart[] {
  const a = sentences(before);
  const b = sentences(after);
  // LCS
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].trim() === b[j].trim() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].trim() === b[j].trim()) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "ins", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "ins", text: b[j] }); j++; }
  return out;
}

export function AiReviewPanel({ draft, conversationId, onApply }: AiReviewPanelProps) {
  const [aspects, setAspects] = useState<ReviewAspect[]>(["typo", "risk", "tone"]);
  const [res, setRes] = useState<ReviewRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"diff" | "after" | "before">("diff");
  const [reviewed, setReviewed] = useState("");   // 添削にかけた元の文

  const diff = useMemo(
    () => (res ? diffSentences(reviewed, res.revised) : []),
    [res, reviewed],
  );

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, suggest: 0 };
    for (const i of res?.issues ?? []) c[i.severity]++;
    return c;
  }, [res]);

  const toggle = (k: ReviewAspect) =>
    setAspects((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const run = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const target = draft;
      const r = await aiReview({ draft: target, conversationId, aspects });
      setReviewed(target);
      setRes(r);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const applyIssue = (issue: ReviewIssue) => {
    if (!issue.quote || !issue.fix) return;
    onApply(draft.split(issue.quote).join(issue.fix));
  };

  const launchChat = () => openAiChat({
    mode: "review",
    source: { screen: "チャット" },
    seed: { draft, conversationId },
    onApply: (p) => { if (typeof p.text === "string") onApply(p.text); },
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="px-4 py-2.5 border-b border-gray-200 bg-red-50 shrink-0">
        <h2 className="text-[13px] font-extrabold">✎ AI添削</h2>
        <p className="text-[10.5px] text-gray-500 mt-0.5">送信前に文面をチェックします（送信はしません）</p>
        <button onClick={launchChat}
          className="mt-2 w-full flex items-center justify-center gap-2 bg-red-600 text-white text-[11.5px] font-bold py-1.5 rounded-lg hover:bg-red-700">
          AIチャットで添削 <span className="text-[10px] opacity-85">↗ 別タブ</span>
        </button>
      </div>

      {/* 観点 */}
      <div className="px-3.5 py-2.5 border-b border-gray-200 shrink-0">
        <div className="text-[10px] text-gray-500 font-bold mb-1.5">チェック観点</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {REVIEW_ASPECTS.map((a) => (
            <button key={a.key} onClick={() => toggle(a.key)}
              className={`text-[10px] px-2 py-1 rounded-full font-bold border ${aspects.includes(a.key) ? "bg-red-600 text-white border-red-600" : "border-gray-200 text-gray-500 bg-white"}`}>
              {a.label}
            </button>
          ))}
        </div>
        <button onClick={run} disabled={busy || !draft.trim()}
          className="w-full py-2.5 rounded-xl bg-red-600 text-white font-extrabold text-[12.5px] hover:bg-red-700 disabled:opacity-40">
          {busy ? "添削中…" : "✎ 入力欄の文面を添削する"}
        </button>
        {!draft.trim() && (
          <div className="text-[10px] text-gray-400 text-center pt-1.5">入力欄に文面を書いてから実行してください</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 min-h-0">
        {err && <div className="text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{err}</div>}

        {!res && !busy && !err && (
          <p className="text-center text-[11.5px] text-gray-400 py-8">
            誤字・敬語、<b className="text-gray-600">リスク表現（断定・約束・個人情報）</b>、<br />トーンをチェックし、修正案を差分で出します。
          </p>
        )}

        {res && (
          <>
            {/* 指摘サマリ */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className="text-[11px] font-extrabold">指摘 {res.issues.length}件</span>
              {counts.critical > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-bold">要修正 {counts.critical}</span>}
              {counts.warning > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold">注意 {counts.warning}</span>}
              {counts.suggest > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">提案 {counts.suggest}</span>}
              <span className="ml-auto text-[10px] text-gray-400">{res.stats.before}字 → {res.stats.after}字</span>
            </div>

            {res.issues.length === 0 && (
              <div className="text-[11.5px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
                ✓ 指摘はありません。そのまま送信できます。
              </div>
            )}

            {/* 指摘カード */}
            <div className="space-y-2 mb-3">
              {res.issues.map((it, i) => {
                const st = SEV_STYLE[it.severity] ?? SEV_STYLE.suggest;
                return (
                  <div key={i} className={`rounded-r-lg px-2.5 py-2 ${st.box}`}>
                    <div className={`text-[10px] font-extrabold mb-0.5 ${st.tag}`}>{st.label} — {it.category}</div>
                    {it.quote && <div className="text-[11px] text-gray-500 mb-0.5">「{it.quote}」</div>}
                    <div className="text-[11.5px] text-gray-700 leading-relaxed">{it.reason}</div>
                    {it.fix && (
                      <div className="flex items-start gap-1.5 mt-1">
                        <div className="text-[10.5px] text-gray-600 flex-1">→ {it.fix}</div>
                        {it.quote && (
                          <button onClick={() => applyIssue(it)}
                            className="text-[9.5px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 shrink-0 hover:border-red-300">
                            個別に採用
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 差分 / 修正後 / 元の文 */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border-b border-gray-200">
                <b className="text-[11px]">添削結果</b>
                <div className="ml-auto inline-flex bg-gray-100 rounded-md p-0.5">
                  {([["diff", "差分"], ["after", "修正後"], ["before", "元の文"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setView(k)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded ${view === k ? "bg-white text-red-600 shadow-sm" : "text-gray-500"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-3 py-2.5 text-[12px] leading-7 text-gray-700 max-h-[240px] overflow-y-auto">
                {view === "diff" && diff.map((p, i) => (
                  <span key={i}
                    className={p.type === "del" ? "bg-red-100 text-red-800 line-through rounded px-0.5"
                      : p.type === "ins" ? "bg-green-100 text-green-800 rounded px-0.5" : ""}>
                    {p.text}
                  </span>
                ))}
                {view === "after" && <span className="whitespace-pre-wrap">{res.revised}</span>}
                {view === "before" && <span className="whitespace-pre-wrap text-gray-500">{reviewed}</span>}
              </div>
            </div>
          </>
        )}
      </div>

      {res && (
        <div className="border-t border-gray-200 px-3.5 py-2.5 bg-red-50 shrink-0">
          <button onClick={() => onApply(res.revised)}
            className={`w-full py-2 rounded-lg text-white text-xs font-bold ${counts.critical > 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"}`}>
            {counts.critical > 0 ? "⚠ 要修正あり — それでも修正後を入力欄へ反映" : "修正後を入力欄へ反映"}
          </button>
          <div className="text-[9.5px] text-gray-400 text-center pt-1.5">反映後も編集可能・送信は人が行います</div>
        </div>
      )}
    </div>
  );
}
