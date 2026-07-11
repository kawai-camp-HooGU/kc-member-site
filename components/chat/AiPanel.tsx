"use client";
// ============================================================
// ② オペレーター向け「AIとの相談チャット」（右カラム）
//
//   ・最上部に大きな「✦ 提案メッセージを生成」ボタンを固定
//   ・AIの発話（吹き出し）と、顧客に送るメッセージ（生成カード）を
//     視覚的にもデータ的にも完全分離（talk / drafts）
//   ・壁打ちで改訂すると新しいカードが下に積まれる（上書きしない）
//   ・出口は「▸ 入力欄に反映」のみ。AIは送信APIを呼ばない。
//   ・タブ切替で ③ AI添削（AiReviewPanel）へ
// ============================================================
import { useEffect, useRef, useState } from "react";
import { aiReplySuggest, aiSummarize } from "../../lib/aiClient";
import { errMessage } from "../../lib/errors";
import { AiReviewPanel } from "./AiReviewPanel";
import type { AiDraft, AiLength, AiTone, AiTurn } from "../../lib/ai/types";

export interface AiPanelProps {
  /** 対象の会話（顧客スレッド） */
  conversationId: number | null;
  /** Composer の現在値（③添削の対象） */
  draftText: string;
  /** 案を入力欄へ反映 */
  onAdopt: (text: string) => void;
}

const TONES: { v: AiTone; l: string }[] = [
  { v: "standard", l: "トーン：標準" },
  { v: "polite", l: "トーン：丁寧" },
  { v: "casual", l: "トーン：カジュアル" },
];
const LENGTHS: { v: AiLength; l: string }[] = [
  { v: "standard", l: "長さ：標準" },
  { v: "short", l: "長さ：短く" },
  { v: "long", l: "長さ：詳しく" },
];
const QUICK = ["もっと短く", "もっと丁寧に", "代替日を提案して", "謝罪を厚めに"];

let seq = 0;
const uid = () => `t${++seq}`;

export function AiPanel({ conversationId, draftText, onAdopt }: AiPanelProps) {
  const [tab, setTab] = useState<"suggest" | "review">("suggest");

  // 顧客スレッドごとに相談ログを保持（切り替えて戻っても残る）
  const [logs, setLogs] = useState<Record<number, AiTurn[]>>({});
  const turns = conversationId != null ? (logs[conversationId] ?? []) : [];

  const [tone, setTone] = useState<AiTone>("standard");
  const [length, setLength] = useState<AiLength>("standard");
  const [count, setCount] = useState<1 | 2 | 3>(3);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [used, setUsed] = useState<{ messages: number; knowledge: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns.length, busy]);

  const push = (items: AiTurn[]) => {
    if (conversationId == null) return;
    setLogs((p) => ({ ...p, [conversationId]: [...(p[conversationId] ?? []), ...items] }));
  };
  const reset = () => {
    if (conversationId == null) return;
    setLogs((p) => ({ ...p, [conversationId]: [] }));
    setUsed(null); setErr("");
  };

  /** 相談チャットの履歴を API へ渡す形に（talk / op のみ。カード本文は送らない） */
  const history = turns
    .filter((t): t is Extract<AiTurn, { kind: "op" | "talk" }> => t.kind === "op" || t.kind === "talk")
    .map((t) => ({ role: (t.kind === "op" ? "user" : "assistant") as "user" | "assistant", content: t.text }));

  const run = async (action: "generate" | "chat", message?: string) => {
    if (conversationId == null || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await aiReplySuggest({
        conversationId, action, tone, length, count,
        message, history,
      });
      setUsed(res.usedContext);
      const items: AiTurn[] = [];
      if (res.talk) items.push({ kind: "talk", id: uid(), text: res.talk });
      for (const d of res.drafts) items.push({ kind: "draft", id: uid(), draft: d });
      push(items);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    push([{ kind: "system", id: uid(), text: `✦ 提案メッセージを生成しました（${count}案）` }]);
    run("generate");
  };

  const chat = (t: string) => {
    const text = t.trim();
    if (!text) return;
    push([{ kind: "op", id: uid(), text }]);
    setMsg("");
    run("chat", text);
  };

  const summarize = async () => {
    if (conversationId == null || busy) return;
    setBusy(true); setErr("");
    try {
      const s = await aiSummarize(conversationId);
      push([{ kind: "talk", id: uid(), text: s }]);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (conversationId == null) {
    return (
      <div className="w-[360px] shrink-0 bg-white border-l border-gray-200 h-full grid place-items-center text-xs text-gray-400">
        会話を選択してください
      </div>
    );
  }

  return (
    <div className="w-[360px] shrink-0 flex flex-col bg-white border-l border-gray-200 h-full">
      {/* ヘッダ */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-red-50 flex items-center gap-2 shrink-0">
        <span className="w-7 h-7 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[10px] shrink-0">AI</span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-extrabold leading-tight">AIアシスタント</h2>
          <p className="text-[10px] text-gray-500 truncate">この顧客への返信を一緒に考えます</p>
        </div>
        <button onClick={reset} className="ml-auto text-[10px] px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-500 shrink-0 hover:bg-gray-50">
          🗑 リセット
        </button>
      </div>

      {/* タブ */}
      <div className="flex gap-1 px-3.5 pt-2 pb-2 border-b border-gray-200 shrink-0">
        <button onClick={() => setTab("suggest")}
          className={`flex-1 text-[11.5px] py-1.5 rounded-lg font-bold border ${tab === "suggest" ? "bg-red-50 border-red-200 text-red-600" : "border-transparent text-gray-500 hover:bg-gray-50"}`}>
          ✦ 返信提案
        </button>
        <button onClick={() => setTab("review")}
          className={`flex-1 text-[11.5px] py-1.5 rounded-lg font-bold border ${tab === "review" ? "bg-red-50 border-red-200 text-red-600" : "border-transparent text-gray-500 hover:bg-gray-50"}`}>
          ✎ 添削
        </button>
      </div>

      {tab === "review" ? (
        <div className="flex-1 min-h-0">
          <AiReviewPanel draft={draftText} conversationId={conversationId} onApply={onAdopt} />
        </div>
      ) : (
        <>
          {/* ★ 生成ボタン（常時最上部に固定） */}
          <div className="px-3.5 py-3 border-b border-gray-200 bg-gradient-to-b from-red-50 to-white shrink-0">
            <button onClick={generate} disabled={busy}
              className="w-full py-3 rounded-xl bg-red-600 text-white font-extrabold text-[13.5px] shadow-md shadow-red-600/25 hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
              <span className="text-base">✦</span>{busy ? "生成中…" : "提案メッセージを生成"}
            </button>
            <div className="flex items-center gap-1.5 mt-2">
              <select value={tone} onChange={(e) => setTone(e.target.value as AiTone)}
                className="flex-1 text-[10.5px] border border-gray-200 rounded-md px-1.5 py-1 bg-white">
                {TONES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <select value={length} onChange={(e) => setLength(e.target.value as AiLength)}
                className="flex-1 text-[10.5px] border border-gray-200 rounded-md px-1.5 py-1 bg-white">
                {LENGTHS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <select value={count} onChange={(e) => setCount(Number(e.target.value) as 1 | 2 | 3)}
                className="text-[10.5px] border border-gray-200 rounded-md px-1.5 py-1 bg-white">
                <option value={3}>案の数：3</option>
                <option value={2}>2</option>
                <option value={1}>1</option>
              </select>
            </div>
            {used && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-[9.5px] text-gray-500">💬 履歴 {used.messages}件</span>
                <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-[9.5px] text-gray-500">👤 顧客情報</span>
                <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-[9.5px] text-gray-500">📚 ナレッジ {used.knowledge}件</span>
                <span className="text-[9.5px] text-gray-400 ml-auto self-center">を参照しました</span>
              </div>
            )}
          </div>

          {/* 相談チャット本体 */}
          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3 bg-gray-50/50 min-h-0">
            {turns.length === 0 && !busy && (
              <p className="text-center text-[11.5px] text-gray-400 py-8">
                上の<b className="text-red-600">「✦ 提案メッセージを生成」</b>を押すと、<br />
                履歴・顧客情報・ナレッジをもとに返信案を作ります。
              </p>
            )}

            {turns.map((t) => {
              if (t.kind === "system") {
                return (
                  <div key={t.id} className="text-center">
                    <span className="text-[9.5px] text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">{t.text}</span>
                  </div>
                );
              }
              if (t.kind === "op") {
                return (
                  <div key={t.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-neutral-900 text-white rounded-2xl rounded-br-sm px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
                      {t.text}
                    </div>
                  </div>
                );
              }
              if (t.kind === "talk") {
                return (
                  <div key={t.id} className="flex gap-2">
                    <span className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[9px] shrink-0">AI</span>
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 text-[11.5px] leading-relaxed text-gray-700 max-w-[88%] whitespace-pre-wrap break-words">
                      {t.text}
                    </div>
                  </div>
                );
              }
              return <DraftCard key={t.id} draft={t.draft} onAdopt={onAdopt} onReview={(text) => { onAdopt(text); setTab("review"); }} />;
            })}

            {busy && (
              <div className="flex gap-2">
                <span className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[9px] shrink-0">AI</span>
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 text-[11.5px] text-gray-400">考えています…</div>
              </div>
            )}
            {err && <div className="text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
            <div ref={endRef} />
          </div>

          {/* 相談入力 */}
          <div className="border-t border-gray-200 bg-white px-3.5 pt-2 pb-2.5 shrink-0">
            <div className="flex gap-1 flex-wrap mb-1.5">
              {QUICK.map((q) => (
                <button key={q} onClick={() => chat(q)} disabled={busy}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:border-red-300 disabled:opacity-40">
                  {q}
                </button>
              ))}
              <button onClick={summarize} disabled={busy}
                className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:border-red-300 disabled:opacity-40">
                この顧客の要約
              </button>
            </div>
            <div className="flex gap-2 items-end">
              <textarea rows={1} value={msg} onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); chat(msg); } }}
                placeholder="AIに相談…（例：謝罪をもう少し厚めに）"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[11.5px] resize-none min-h-[36px] max-h-24 focus:outline-none focus:border-red-400" />
              <button onClick={() => chat(msg)} disabled={busy || !msg.trim()}
                className="bg-neutral-900 text-white font-bold rounded-xl px-3.5 h-9 text-[11px] shrink-0 disabled:opacity-40">
                送信
              </button>
            </div>
            <div className="text-[9.5px] text-gray-400 text-center pt-1.5">
              反映 → 入力欄で編集 → <b className="text-gray-500">送信は人が行います</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── 生成メッセージカード（顧客に送る本文。AIの発話とは別要素）──
function DraftCard({ draft, onAdopt, onReview }: {
  draft: AiDraft;
  onAdopt: (t: string) => void;
  onReview: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const warn = draft.needsInput.length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  return (
    <div className="border-2 border-red-500 rounded-xl overflow-hidden bg-white shadow-sm shadow-red-600/10">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-red-600">
        <span className="text-[10.5px] font-extrabold text-white">✦ 生成メッセージ {draft.label}</span>
        {draft.tone && <span className="text-[9px] text-white/90 bg-white/20 px-1.5 py-0.5 rounded-full font-bold">{draft.tone}</span>}
        <span className="ml-auto text-[9.5px] text-white/80 shrink-0">{draft.text.length}字</span>
      </div>

      <div className="px-3 py-3 text-[12.5px] whitespace-pre-wrap break-words text-gray-800 leading-relaxed bg-red-50/30">
        {draft.text}
      </div>

      <div className="px-3 py-2 border-t border-red-100 bg-white">
        {draft.basis.length > 0 && (
          <div className="text-[9.5px] text-gray-500 mb-1.5">
            <b className="text-gray-700">根拠:</b> {draft.basis.join(" ／ ")}
          </div>
        )}
        {warn && (
          <div className="text-[9.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1.5">
            ⚠ [要確認] が {draft.needsInput.length} 箇所あります（{draft.needsInput.join("・")}）。埋めてから送信してください。
          </div>
        )}
        <div className="flex gap-1.5">
          <button onClick={() => onAdopt(draft.text)}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold bg-red-600 text-white hover:bg-red-700">
            ▸ 入力欄に反映
          </button>
          <button onClick={copy}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-gray-200 text-gray-600 hover:bg-gray-50">
            {copied ? "✓" : "コピー"}
          </button>
          <button onClick={() => onReview(draft.text)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-gray-200 text-gray-600 hover:bg-gray-50">
            ✎ 添削
          </button>
        </div>
      </div>
    </div>
  );
}
