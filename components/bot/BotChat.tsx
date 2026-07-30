"use client";
// ============================================================
// KAWAI BRAIN AI ｜ コックピットUI（C系ダーク / ラインアイコン）
//   ・portal(cockpit): 履歴レール＋会話＋根拠パネルの3カラム。
//   ・standalone: 単カラム（体験版/独立ページ用）。
//   ・POST /api/bot を apiFetch で呼ぶ。絵文字はロゴ以外で不使用。
// ============================================================
import { useState, useRef, useEffect, useCallback } from "react";
import { apiFetch } from "../../lib/apiClient";
import { LogoMark } from "../layout/LogoMark";
import { BotBrand } from "./BotBrand";
import type { BotAskRes, BotSource } from "../../lib/bot/types";
import {
  IcPlus, IcSearch, IcClock, IcGlobe, IcSend, IcArrowUp, IcPaperclip,
  IcBookmark, IcFile, IcList, IcUser, IcCopy, IcRefresh, IcExpand, IcSettings,
  IcRocket, IcCalendar, IcCoin, IcExternal,
} from "./icons";

/** X（旧Twitter）出典用の小さなブランドバッジ（×印に見えないよう文字で表現）。 */
function XGlyph({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center justify-center rounded-[3px] bg-[#33617d] text-white font-black leading-none ${className}`} style={{ fontFamily: "system-ui, sans-serif" }}>X</span>;
}

interface Msg {
  id: number;
  role: "user" | "bot";
  text: string;
  sources?: BotSource[];
  refused?: boolean;
  error?: boolean;
}

export interface BotChatProps {
  shareToken?: string | null;
  passcode?: string | null;
  variant?: "portal" | "standalone";
  greeting?: string;
  suggestions?: string[];
  /** ヘッダー歯車から呼ぶ（ボット設定へ遷移など） */
  onSettings?: () => void;
}

const DEFAULT_SUGGESTIONS = ["料金プランは？", "どんな人向け？", "始め方を教えて"];
const QUICK = [
  { Icon: IcRocket, label: "入会の流れ", q: "入会の流れを教えて" },
  { Icon: IcCalendar, label: "説明会を予約", q: "説明会の予約について教えて" },
  { Icon: IcCoin, label: "料金を調べる", q: "料金プランは？" },
];

export function BotChat({
  shareToken = null,
  passcode = null,
  variant = "portal",
  greeting = "こんにちは。KAWAI CAMPについて、気になることを聞いてください。",
  suggestions = DEFAULT_SUGGESTIONS,
  onSettings,
}: BotChatProps) {
  const cockpit = variant === "portal";
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const h = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggleFull = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { /* noop */ });
    else void el.requestFullscreen?.().catch(() => { /* noop */ });
  };
  const idRef = useRef(1);
  const nextId = () => idRef.current++;
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: "bot", text: greeting }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [useWeb, setUseWeb] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);

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
        id: nextId(), role: "bot", text: json.answer ?? "",
        sources: json.sources ?? [], refused: json.refused ?? false,
      }]);
      if (typeof json.remaining === "number") setRemaining(json.remaining);
      if (json.remaining === 0) setLocked(true);
    } catch {
      setMessages((m) => [...m, { id: nextId(), role: "bot", text: "接続できませんでした。時間をおいてお試しください。", error: true }]);
    } finally {
      setSending(false);
    }
  }, [sending, locked, useWeb, shareToken, passcode]);

  const reset = () => { setMessages([{ id: nextId(), role: "bot", text: greeting }]); setInput(""); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
  };

  const userMsgs = messages.filter((m) => m.role === "user");
  const showSuggest = userMsgs.length === 0 && !sending;
  const evidence: BotSource[] = [...messages].reverse().find((m) => m.role === "bot" && (m.sources?.length ?? 0) > 0)?.sources ?? [];

  const copySources = () => {
    const txt = evidence.map((s) => srcTitle(s)).join("\n");
    void navigator.clipboard?.writeText(txt).catch(() => { /* noop */ });
  };

  // ── 根拠パネル（コックピット／体験版で共用）──
  const eviAsideCls = "bg-[#1a1917] border-l border-[#2b2926] p-3.5 overflow-y-auto flex flex-col min-h-0";
  const eviContent = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-[#a8a196] mb-3"><IcList className="w-4 h-4 text-[#ff9ea2]" />根拠（出典）<span className="ml-auto text-[10px] text-[#736e66]">{evidence.length}件</span></div>
      {evidence.length === 0 ? (
        <div className="text-[11px] text-[#5a564e] leading-relaxed">回答すると、その根拠となった出典がここに表示されます。</div>
      ) : (
        <>
          {evidence.map((s, i) => <EvidenceCard key={i} source={s} />)}
          <button onClick={copySources} className="mt-auto flex items-center justify-center gap-1.5 text-[11px] text-[#a8a196] border border-[#37342f] rounded-lg py-2 hover:border-[#ee1c25] hover:text-[#ff9ea2]"><IcCopy className="w-3.5 h-3.5" />出典をコピー</button>
        </>
      )}
    </>
  );

  const outer = cockpit
    ? (isFull ? "h-screen" : "h-[calc(100dvh-118px)] min-h-[480px] border border-[#2b2926] rounded-2xl")
    : "h-full";

  // ── 会話ゾーン（両バリアント共通）──
  const conversation = (
    <div className="flex flex-col min-w-0 min-h-0 h-full bg-[#100f0e]">
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 items-start ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {m.role === "user" ? (
              <div className="w-7 h-7 rounded-lg bg-[#2a2824] text-[#a8a196] flex items-center justify-center shrink-0"><IcUser className="w-4 h-4" /></div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-black border border-[#37342f] flex items-center justify-center p-1 shrink-0"><LogoMark box="w-full h-full" /></div>
            )}
            <div className={`max-w-[80%] flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : ""}`}>
              <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                m.role === "user" ? "bg-[#ee1c25] text-white rounded-tr-sm"
                : m.error || m.refused ? "bg-[#241f16] border border-[#4a3f22] text-[#e0b45a] rounded-tl-sm"
                : "bg-[#201f1c] border border-[#2b2926] text-[#f3efe8] rounded-tl-sm"}`}>
                {m.text}
              </div>
              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">{m.sources.map((s, i) => <SourceChip key={i} source={s} />)}</div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-lg bg-black border border-[#37342f] flex items-center justify-center p-1 shrink-0"><LogoMark box="w-full h-full" /></div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[#201f1c] border border-[#2b2926] flex gap-1.5">
              <Dot /><Dot /><Dot />
            </div>
          </div>
        )}
      </div>

      {showSuggest && suggestions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-2 px-5 pb-3">
          {suggestions.map((s) => (
            <button key={s} onClick={() => void send(s)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#ff9ea2] bg-[rgba(238,28,37,0.09)] border border-[rgba(238,28,37,0.3)] rounded-full px-3 py-1.5 hover:bg-[rgba(238,28,37,0.16)]">
              <IcArrowUp className="w-3 h-3" />{s}
            </button>
          ))}
        </div>
      )}

      {/* コンポーザ */}
      <div className="shrink-0 flex items-end gap-2.5 px-4 py-3 border-t border-[#2b2926] bg-[#1a1917]">
        <button type="button" title="添付" className="w-9 h-9 shrink-0 rounded-xl border border-[#37342f] text-[#a8a196] flex items-center justify-center hover:border-[#ee1c25] hover:text-[#ff9ea2]"><IcPaperclip className="w-[18px] h-[18px]" /></button>
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
          rows={1} disabled={locked}
          placeholder={locked ? "本日の利用は終了しました" : "メッセージを入力…（Shift+Enterで改行）"}
          className="flex-1 min-w-0 resize-none bg-[#161513] border border-[#37342f] rounded-xl px-3.5 py-2.5 text-sm text-[#f3efe8] placeholder-[#736e66] focus:outline-none focus:border-[#ee1c25] disabled:opacity-60"
        />
        <button type="button" onClick={() => setUseWeb((v) => !v)} title="外部情報(Web)を併用"
          className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2.5 rounded-xl border text-[11px] ${
            useWeb ? "bg-[rgba(238,28,37,0.12)] border-[rgba(238,28,37,0.5)] text-[#ff9ea2]" : "bg-transparent border-[#37342f] text-[#a8a196]"}`}>
          <IcGlobe className="w-4 h-4" /><span className="hidden sm:inline">外部</span>
        </button>
        <button onClick={() => void send(input)} disabled={sending || locked || !input.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 bg-[#ee1c25] text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:brightness-110 disabled:opacity-40">
          <IcSend className="w-4 h-4" />送信
        </button>
      </div>

      {remaining != null && (
        <div className="shrink-0 flex items-center justify-center gap-1.5 text-[11px] text-[#736e66] py-2 bg-[#151311] border-t border-[#2b2926]">
          <IcClock className="w-3 h-3" />本日の残り <span className="font-bold text-[#ff9ea2]">{remaining}</span> 回
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className={`flex flex-col bg-[#100f0e] text-[#f3efe8] overflow-hidden ${outer}`}>
      {/* ステータスバー */}
      <header className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-[#2b2926] bg-[#1a1917]">
        <LogoMark box="w-8 h-8" />
        <BotBrand variant="dark" showSub={!cockpit} />
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold rounded-full px-2.5 py-1 border border-[rgba(238,28,37,0.45)] bg-[rgba(238,28,37,0.12)] text-[#ff9ea2]">
            {shareToken ? "体験版" : "会員"}
          </span>
          {cockpit && (
            <>
              <button title="新しい会話" onClick={reset} className="w-8 h-8 rounded-lg border border-[#37342f] text-[#a8a196] flex items-center justify-center hover:border-[#ee1c25] hover:text-[#ff9ea2]"><IcRefresh className="w-[17px] h-[17px]" /></button>
              <button title={isFull ? "全画面を解除" : "全画面表示"} onClick={toggleFull} className="w-8 h-8 rounded-lg border border-[#37342f] text-[#a8a196] flex items-center justify-center hover:border-[#ee1c25] hover:text-[#ff9ea2]"><IcExpand className="w-[17px] h-[17px]" /></button>
              {onSettings && (
                <button title="ボット設定" onClick={onSettings} className="w-8 h-8 rounded-lg border border-[#37342f] text-[#a8a196] flex items-center justify-center hover:border-[#ee1c25] hover:text-[#ff9ea2]"><IcSettings className="w-[17px] h-[17px]" /></button>
              )}
            </>
          )}
        </div>
      </header>

      {cockpit ? (
        <div className="flex-1 grid grid-cols-[200px_1fr_310px] min-h-0 max-[1000px]:grid-cols-[180px_1fr] max-[680px]:grid-cols-1">
          {/* 左：履歴・クイックアクション */}
          <aside className="bg-[#1a1917] border-r border-[#2b2926] p-3 flex flex-col gap-2 overflow-y-auto min-h-0 max-[680px]:hidden">
            <div className="flex items-center gap-2 bg-[#141311] border border-[#37342f] rounded-lg px-3 py-2 text-[11px] text-[#736e66]"><IcSearch className="w-3.5 h-3.5" />会話を検索…</div>
            <button onClick={reset} className="flex items-center justify-center gap-1.5 bg-[#ee1c25] text-white rounded-lg py-2.5 font-bold text-xs hover:brightness-110"><IcPlus className="w-4 h-4" />新しい会話</button>
            <div className="text-[10px] text-[#736e66] tracking-wider uppercase mt-2 px-1">最近の会話</div>
            {userMsgs.length === 0 ? (
              <div className="text-[11px] text-[#5a564e] px-1 py-1">まだ会話がありません</div>
            ) : (
              [...userMsgs].reverse().slice(0, 8).map((m, i) => (
                <div key={m.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${i === 0 ? "border-[#ee1c25] text-[#ffb2b6] bg-[rgba(238,28,37,0.06)]" : "border-[#2b2926] text-[#a8a196]"}`}>
                  <IcClock className="w-3.5 h-3.5 shrink-0 opacity-70" /><span className="flex-1 truncate">{m.text}</span>
                </div>
              ))
            )}
            <div className="text-[10px] text-[#736e66] tracking-wider uppercase mt-2 px-1">クイックアクション</div>
            {QUICK.map((q) => (
              <button key={q.label} onClick={() => void send(q.q)} className="flex items-center gap-2 bg-[#141311] border border-[#2b2926] rounded-lg px-2.5 py-2 text-[11px] text-[#a8a196] hover:border-[#ee1c25] text-left">
                <q.Icon className="w-3.5 h-3.5 shrink-0 text-[#ff9ea2]" /><span className="flex-1">{q.label}</span>
              </button>
            ))}
          </aside>

          {conversation}

          {/* 右：根拠パネル */}
          <aside className={`${eviAsideCls} max-[1000px]:hidden`}>{eviContent}</aside>
        </div>
      ) : (
        // 体験版：会話＋（画面が広いときだけ）根拠パネル
        <div className="flex-1 min-h-0 grid grid-cols-[1fr_300px] max-[900px]:grid-cols-1">
          {conversation}
          <aside className={`${eviAsideCls} max-[900px]:hidden`}>{eviContent}</aside>
        </div>
      )}
    </div>
  );
}

// ── 出典チップ（媒体別ラインアイコン）──
function srcTitle(s: BotSource): string {
  if (s.type === "web") return s.title || "外部情報";
  if (s.type === "doc") return s.title;
  return `ブックマーク：${s.genre}`;
}
function SourceChip({ source }: { source: BotSource }) {
  if (source.type === "web") {
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 bg-[rgba(122,79,138,0.2)] text-[#c9a6d6]"><IcGlobe className="w-3 h-3" />{source.title || "外部"}</span>;
  }
  if (source.type === "doc") {
    if (source.docType === "note") return <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 bg-[rgba(47,107,79,0.18)] text-[#8fe0b0]"><IcFile className="w-3 h-3" />note</span>;
    if (source.docType === "x") return <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 bg-[rgba(51,97,125,0.2)] text-[#9cc7de]"><XGlyph className="w-3 h-3 text-[8px]" />X投稿</span>;
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 bg-[rgba(238,28,37,0.14)] text-[#ff9ea2]"><IcBookmark className="w-3 h-3" />{source.title}</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 bg-[rgba(238,28,37,0.14)] text-[#ff9ea2]"><IcBookmark className="w-3 h-3" />{source.genre}</span>;
}

// ── 根拠カード（抜粋＋関連度）。URLがあればクリックで原文へ遷移 ──
function EvidenceCard({ source }: { source: BotSource }) {
  const pct = Math.max(5, Math.min(100, Math.round((source.score ?? 0.5) * 100)));
  const url = source.type === "web" ? source.url : source.type === "doc" ? source.url : null;
  const label = source.type === "web"
    ? <span className="text-[#c9a6d6] inline-flex items-center gap-1.5 min-w-0"><IcGlobe className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{source.title || "外部情報"}</span></span>
    : source.type === "doc"
      ? (source.docType === "note"
          ? <span className="text-[#8fe0b0] inline-flex items-center gap-1.5 min-w-0"><IcFile className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{source.title}</span></span>
          : source.docType === "x"
            ? <span className="text-[#9cc7de] inline-flex items-center gap-1.5 min-w-0"><XGlyph className="w-4 h-4 text-[10px] shrink-0" /><span className="truncate">{source.title}</span></span>
            : <span className="text-[#ff9ea2] inline-flex items-center gap-1.5 min-w-0"><IcBookmark className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{source.title}</span></span>)
      : <span className="text-[#ff9ea2] inline-flex items-center gap-1.5 min-w-0"><IcBookmark className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{source.genre}</span></span>;

  const body = (
    <>
      <div className="text-[11px] font-bold flex items-center gap-1.5">
        <span className="flex-1 min-w-0">{label}</span>
        {url && <IcExternal className="w-3.5 h-3.5 text-[#736e66] shrink-0" />}
      </div>
      {source.excerpt && <div className="text-[10px] text-[#a8a196] mt-1.5 leading-relaxed">{source.excerpt}…</div>}
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1 bg-[#2a2824] rounded-full overflow-hidden"><div className="h-full bg-[#ee1c25]" style={{ width: `${pct}%` }} /></div>
        <span className="text-[9px] text-[#736e66]">関連 {pct}%</span>
      </div>
    </>
  );
  const cls = "block bg-[#161513] border border-[#2b2926] rounded-xl p-2.5 mb-2 transition-colors";
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:border-[#ee1c25] cursor-pointer`}>{body}</a>
    : <div className={cls}>{body}</div>;
}

function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-[#5a564e] inline-block animate-pulse" />;
}
