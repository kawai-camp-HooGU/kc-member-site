"use client";
// ============================================================
// 公開問い合わせボット 共通チャットUI
//   ・ポータル内（会員）と独立ページ（未ログイン/体験版）で共通利用する。
//   ・POST /api/bot を apiFetch で叩く（ログイン中なら自動でトークン付与）。
//   ・出典チップ（📌ブックマーク / 🌐外部）・残回数・辞退/上限状態に対応。
// ============================================================
import { useState, useRef, useEffect, useCallback } from "react";
import { apiFetch } from "../../lib/apiClient";
import type { BotAskRes, BotSource } from "../../lib/bot/types";

interface Msg {
  id: number;
  role: "user" | "bot";
  text: string;
  sources?: BotSource[];
  refused?: boolean;
  error?: boolean;
}

export interface BotChatProps {
  /** 体験版URLのトークン（独立ページ用） */
  shareToken?: string | null;
  /** 体験版のパスコード（設定されている場合） */
  passcode?: string | null;
  /** 見た目のバリアント。portal=ポータル内カード / standalone=独立ページ */
  variant?: "portal" | "standalone";
  /** 冒頭のあいさつ */
  greeting?: string;
  /** 候補質問（先頭のみ表示、送信で消える） */
  suggestions?: string[];
}

const DEFAULT_SUGGESTIONS = ["料金プランは？", "どんな人向け？", "始め方を教えて"];

export function BotChat({
  shareToken = null,
  passcode = null,
  variant = "portal",
  greeting = "こんにちは！KAWAI-CAMPについて、気になることを聞いてください。",
  suggestions = DEFAULT_SUGGESTIONS,
}: BotChatProps) {
  const idRef = useRef(1);
  const nextId = () => idRef.current++;
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: "bot", text: greeting }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [useWeb, setUseWeb] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [locked, setLocked] = useState(false); // 上限到達などで入力不可

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || sending || locked) return;

    setMessages((m) => [...m, { id: nextId(), role: "user", text: message }]);
    setInput("");
    setSending(true);

    try {
      const res = await apiFetch("/api/bot", { method: "POST", body: { message, useWeb, shareToken, passcode } });
      const json = (await res.json().catch(() => ({}))) as Partial<BotAskRes> & { error?: string };

      if (!res.ok) {
        const text = json.error ?? "エラーが発生しました。時間をおいてお試しください。";
        setMessages((m) => [...m, { id: nextId(), role: "bot", text, error: true }]);
        if (res.status === 429 || res.status === 403) setLocked(true);
        return;
      }

      setMessages((m) => [...m, {
        id: nextId(), role: "bot",
        text: json.answer ?? "",
        sources: json.sources ?? [],
        refused: json.refused ?? false,
      }]);
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      if (json.remaining === 0) setLocked(true);
    } catch {
      setMessages((m) => [...m, { id: nextId(), role: "bot", text: "接続できませんでした。時間をおいてお試しください。", error: true }]);
    } finally {
      setSending(false);
    }
  }, [sending, locked, useWeb, shareToken, passcode]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
  };

  const showSuggest = messages.filter((m) => m.role === "user").length === 0 && !sending;
  const outer = variant === "standalone" ? "h-full" : "h-[70vh] min-h-[420px] border border-gray-200 rounded-2xl shadow-sm";

  return (
    <div className={`flex flex-col bg-white overflow-hidden ${outer}`}>
      {/* ヘッダ */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-gray-200">
        <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center text-base shrink-0">🏕️</div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900 leading-tight">KAWAI-CAMP アシスタント</div>
          <div className="text-[11px] text-emerald-600 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />公開ナレッジ参照中
          </div>
        </div>
        <span className="ml-auto text-[11px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5">
          {shareToken ? "🎟️ 体験版" : "🌐 問い合わせ"}
        </span>
      </div>

      {/* スレッド */}
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-neutral-50">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 items-start ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-xs ${m.role === "user" ? "bg-gray-700 text-white" : "bg-red-600 text-white"}`}>
              {m.role === "user" ? "👤" : "🤖"}
            </div>
            <div className={`max-w-[78%] flex flex-col gap-1 ${m.role === "user" ? "items-end" : ""}`}>
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                m.role === "user" ? "bg-gray-700 text-white rounded-tr-sm"
                : m.error ? "bg-amber-50 text-amber-800 border border-amber-200 rounded-tl-sm"
                : m.refused ? "bg-amber-50 text-amber-800 border border-amber-200 rounded-tl-sm"
                : "bg-white text-gray-800 border border-gray-200 rounded-tl-sm"}`}>
                {m.text}
              </div>
              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.sources.map((s, i) => <SourceChip key={i} source={s} />)}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 items-start">
            <div className="w-6 h-6 rounded-md bg-red-600 text-white flex items-center justify-center text-xs shrink-0">🤖</div>
            <div className="px-3 py-2.5 rounded-2xl rounded-tl-sm bg-white border border-gray-200 flex gap-1">
              <Dot /><Dot /><Dot />
            </div>
          </div>
        )}
      </div>

      {/* 候補質問 */}
      {showSuggest && suggestions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-2 px-4 pb-2 bg-neutral-50">
          {suggestions.map((s) => (
            <button key={s} onClick={() => void send(s)}
              className="text-xs font-medium text-red-700 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:bg-red-50">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* 入力 */}
      <div className="shrink-0 flex items-end gap-2 px-3 py-3 border-t border-gray-200 bg-white">
        <button type="button" onClick={() => setUseWeb((v) => !v)} title="外部情報（Web）を併用"
          className={`shrink-0 text-[11px] flex items-center gap-1 px-2 py-2 rounded-lg border transition-colors ${
            useWeb ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-400"}`}>
          🌐<span className="hidden sm:inline">外部</span>
        </button>
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
          rows={1} disabled={locked}
          placeholder={locked ? "本日の利用は終了しました" : "メッセージを入力…（Shift+Enterで改行）"}
          className="flex-1 min-w-0 resize-none bg-neutral-100 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
        />
        <button onClick={() => void send(input)} disabled={sending || locked || !input.trim()}
          className="shrink-0 bg-red-600 text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-red-700 disabled:opacity-40">
          送信
        </button>
      </div>

      {/* 残回数 */}
      {remaining != null && (
        <div className="shrink-0 text-center text-[11px] text-gray-500 py-1.5 bg-amber-50/60 border-t border-gray-100">
          本日の残り <span className="font-bold text-red-700">{remaining}</span> 回
          {remaining === 0 && "（ご利用ありがとうございました）"}
        </div>
      )}
    </div>
  );
}

function SourceChip({ source }: { source: BotSource }) {
  if (source.type === "web") {
    return (
      <span className="text-[11px] rounded-md px-2 py-0.5 border bg-violet-50 text-violet-700 border-violet-200">
        🌐 {source.title || "外部情報"}
      </span>
    );
  }
  if (source.type === "doc") {
    const icon = source.docType === "note" ? "📝" : source.docType === "x" ? "𝕏" : "📌";
    return (
      <span className="text-[11px] rounded-md px-2 py-0.5 border bg-blue-50 text-blue-700 border-blue-200">
        {icon} {source.title}
      </span>
    );
  }
  return (
    <span className="text-[11px] rounded-md px-2 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-200">
      📌 {source.genre}
    </span>
  );
}

function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block animate-pulse" />;
}
