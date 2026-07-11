"use client";
// ============================================================
// ① メンバー向け AI相談ペイン
//   ・公開中コンテンツ／お知らせをもとに回答（出典チップ付き）
//   ・手続き系は回答せず「事務局へ引用」で左ペインへ下書きを流す
//   ・AI発言と事務局発言を絶対に混同させない（赤=AI / 黒=事務局）
// ============================================================
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { aiConsult, aiEscalate } from "../../lib/aiClient";
import { errMessage } from "../../lib/errors";
import type { AiCitation } from "../../lib/ai/types";

interface Turn {
  role: "user" | "assistant";
  body: string;
  citations: AiCitation[];
  escalate: boolean;
  handoffDraft?: string;
}

const SUGGESTS = ["集合場所は？", "雨天時はどうなる？", "キャンセル規定は？", "持ち物を教えて"];

export interface AiConsultPaneProps {
  /** 事務局ペインの入力欄へ引用付き下書きを流し込む */
  onQuoteToStaff: (quote: string, draft: string) => void;
  compact?: boolean;
}

export function AiConsultPane({ onQuoteToStaff, compact }: AiConsultPaneProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [convId, setConvId] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  const send = async (q: string) => {
    const message = q.trim();
    if (!message || busy) return;
    setErr("");
    setText("");
    setTurns((p) => [...p, { role: "user", body: message, citations: [], escalate: false }]);
    setBusy(true);
    try {
      const res = await aiConsult({ aiConversationId: convId, message });
      setConvId(res.aiConversationId);
      setRemaining(res.remaining);
      setTurns((p) => [...p, {
        role: "assistant", body: res.answer, citations: res.citations,
        escalate: res.escalate, handoffDraft: res.handoffDraft,
      }]);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handoff = (t: Turn) => {
    onQuoteToStaff(t.body, t.handoffDraft || "");
    if (convId != null) aiEscalate(convId).catch(() => { /* 記録失敗は無視 */ });
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(text); }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* ヘッダ */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2.5 shrink-0 bg-red-50/50">
        <span className="w-8 h-8 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[10px] shrink-0">AI</span>
        <div className="min-w-0">
          <b className="text-[13px]">AIアシスタント</b>
          <small className="block text-gray-400 text-[10.5px] truncate">24時間即答・公開中の資料をもとに回答します</small>
        </div>
      </div>

      {/* 免責（常時表示・AI発言であることを見失わせない） */}
      <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[10.5px] text-amber-800 shrink-0">
        ⚠ AIの回答です。手続き・料金の確定は事務局にご確認ください。
      </div>

      {/* 会話 */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3 bg-gray-50/40 min-h-0">
        {turns.length === 0 && (
          <p className="text-center text-[11.5px] text-gray-400 py-8">
            キャンプの持ち物・集合場所・当日の流れなど、<br />公開中の資料からAIがお答えします。
          </p>
        )}

        {turns.map((t, i) => t.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] bg-red-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">
              {t.body}
            </div>
          </div>
        ) : (
          <div key={i} className="flex gap-2">
            <span className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[9px] shrink-0">AI</span>
            <div className="max-w-[88%] min-w-0">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 whitespace-pre-wrap break-words">
                {t.body}
              </div>

              {t.citations.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                  <span className="text-[9.5px] text-gray-400 font-bold">参照:</span>
                  {t.citations.map((c) => (
                    <span key={`${c.kind}-${c.id}`}
                      className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-[10px] text-gray-600">
                      {c.kind === "content" ? "📄" : "📢"} {c.title}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1.5 text-[9.5px] text-gray-400">※ 資料に根拠がない一般的なご案内です</div>
              )}

              <div className="mt-1.5">
                <button onClick={() => handoff(t)}
                  className="text-[10px] px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 font-bold hover:bg-red-100">
                  ← 事務局へ引用
                </button>
              </div>

              {t.escalate && (
                <div className="mt-2 border border-red-200 bg-red-50 rounded-xl px-3 py-2.5">
                  <div className="text-[11.5px] font-bold text-red-700 mb-1">🙋 事務局に引き継ぎますか？</div>
                  <p className="text-[11px] text-gray-600 mb-2">
                    この相談内容を引用して、事務局チャットの入力欄に下書きを入れます。送信はご自身で行ってください。
                  </p>
                  <button onClick={() => handoff(t)}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700">
                    ← 事務局へ引き継ぐ
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-2">
            <span className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center font-bold text-[9px] shrink-0">AI</span>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2.5 text-[11.5px] text-gray-400">
              考えています…
            </div>
          </div>
        )}
        {err && <div className="text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
        <div ref={endRef} />
      </div>

      {/* 入力 */}
      <div className="border-t border-gray-200 bg-white px-4 pt-2 pb-2.5 shrink-0"
        style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}>
        {turns.length === 0 && (
          <div className="flex gap-1 flex-wrap mb-1.5">
            {SUGGESTS.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}
                className="text-[11px] px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            placeholder="AIに質問する…（⌘/Ctrl+Enterで送信）"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[16px] sm:text-[13px] resize-none min-h-[40px] max-h-28 focus:outline-none focus:border-red-400" />
          <button onClick={() => send(text)} disabled={busy || !text.trim()}
            className="bg-red-600 text-white font-bold rounded-xl px-4 h-10 text-sm hover:bg-red-700 disabled:opacity-40 shrink-0">
            {busy ? "…" : "送信"}
          </button>
        </div>
        {remaining != null && !compact && (
          <div className="text-[10px] text-gray-400 text-center pt-1">本日の残り相談回数：{remaining}</div>
        )}
      </div>
    </div>
  );
}
