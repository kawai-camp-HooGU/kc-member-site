"use client";
// ============================================================
// メンバー画面（顧客）：事務局チャット ＋ AI相談 の 2ペイン
//   lg以上 : 左右2ペイン同時表示（幅はドラッグで調整・localStorageに保持）
//   lg未満 : 1カラム＋セグメント切替（非表示側の新着はバッジ／トーストで通知）
//   AIの回答は「← 事務局へ引用」で左ペインの入力欄へ引用付き下書きとして入る
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import type { ChatMessage } from "../lib/models";
import { fetchMessages, sendMessage, getOrCreateMyConversation, markMemberRead } from "../lib/chat";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";
import { AiConsultPane } from "../components/chat/AiConsultPane";

type Pane = "staff" | "ai";
const RATIO_KEY = "kawai.memberChat.ratio";
const PANE_KEY = "kawai.memberChat.pane";

export function MemberChatView() {
  const { permission, can } = useMaster();
  const aiEnabled = can("ai_consult");

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [quote, setQuote] = useState("");          // AIから引用した文（送信時に本文へ前置）
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);

  // レスポンシブ
  const [wide, setWide] = useState(true);          // lg以上か
  const [pane, setPane] = useState<Pane>("ai");    // 1カラム時に表示中のペイン
  const [ratio, setRatio] = useState(0.5);         // 左ペインの幅比率
  const [staffNew, setStaffNew] = useState(0);     // AIタブ表示中に届いた事務局メッセージ数

  const cidRef = useRef<number | null>(null);
  const paneRef = useRef<Pane>("ai");
  const wideRef = useRef(true);
  const ratioRef = useRef(0.5);
  const splitRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cidRef.current = conversationId; }, [conversationId]);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { wideRef.current = wide; }, [wide]);
  useEffect(() => { ratioRef.current = ratio; }, [ratio]);

  // ── 画面幅・保存値の復元 ──
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);

    const r = Number(localStorage.getItem(RATIO_KEY));
    if (r >= 0.25 && r <= 0.75) setRatio(r);
    const p = localStorage.getItem(PANE_KEY);
    if (p === "staff" || p === "ai") setPane(p);

    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => { localStorage.setItem(PANE_KEY, pane); }, [pane]);

  // ── 会話の初期化 ──
  useEffect(() => {
    let alive = true;
    (async () => {
      if (permission.myId == null) { setReady(true); return; }
      const cid = await getOrCreateMyConversation(permission.myId);
      if (!alive) return;
      setConversationId(cid);
      if (cid != null) { setMessages(await fetchMessages(cid)); markMemberRead(cid); }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [permission.myId]);

  const reload = useCallback(async (cid: number) => { setMessages(await fetchMessages(cid)); }, []);

  // ── Realtime ──
  useEffect(() => {
    if (conversationId == null) return;
    const ch = supabase.channel("realtime-chat-member")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (p) => {
        const row = (p.new ?? p.old) as { conversation_id?: number; sender_side?: string };
        if (row?.conversation_id !== cidRef.current) return;
        reload(row.conversation_id);
        // 事務局ペインが見えていないときは「新着あり」を出す
        if (row.sender_side === "staff" && !wideRef.current && paneRef.current !== "staff") {
          setStaffNew((n) => n + 1);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, reload]);

  // 事務局ペインが見えている間は既読に
  useEffect(() => {
    if (conversationId == null) return;
    if (wide || pane === "staff") {
      setStaffNew(0);
      markMemberRead(conversationId);
    }
  }, [wide, pane, conversationId, messages.length]);

  // ── 送信（AIからの引用は本文に引用記法で前置）──
  const handleSend = async (body: string, files: File[]) => {
    if (conversationId == null) return;
    const full = quote ? `> ✦ AI相談から引用\n> ${quote.replace(/\n/g, "\n> ")}\n\n${body}` : body;
    setSending(true);
    const msg = await sendMessage({
      conversationId, senderMemberId: permission.myId, side: "member", body: full, files,
    });
    setSending(false);
    if (msg) { setText(""); setQuote(""); setMessages((prev) => [...prev, msg]); }
  };

  // ── AI → 事務局へ引用 ──
  const quoteToStaff = (q: string, draft: string) => {
    setQuote(q);
    if (draft) setText(draft);
    if (!wideRef.current) setPane("staff");
  };

  // ── 仕切りのドラッグ ──
  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const box = splitRef.current;
    if (!box) return;
    const move = (ev: globalThis.MouseEvent) => {
      const rect = box.getBoundingClientRect();
      const r = Math.min(0.75, Math.max(0.25, (ev.clientX - rect.left) / rect.width));
      setRatio(r);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      localStorage.setItem(RATIO_KEY, String(ratioRef.current));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── 事務局ペイン ──
  const staffPane = (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2.5 shrink-0">
        <span className="w-8 h-8 rounded-full bg-neutral-900 text-white grid place-items-center font-bold text-[10px] shrink-0">運</span>
        <div className="min-w-0">
          <b className="text-[13px]">KAWAI CAMP 事務局</b>
          <small className="block text-gray-400 text-[10.5px] truncate">運営スタッフ（管理者・オペレーター）とやり取りできます</small>
        </div>
      </div>

      {!ready ? (
        <div className="flex-1 grid place-items-center text-sm text-gray-400">読み込み中…</div>
      ) : conversationId == null ? (
        <div className="flex-1 grid place-items-center text-sm text-gray-400 px-6 text-center">
          チャットを開始できませんでした。アカウントの紐づけをご確認ください。
        </div>
      ) : (
        <>
          <MessageList messages={messages} outSide="member" whoLabel="事務局"
            emptyText="事務局とのやり取りがここに表示されます。" />
          {quote && (
            <div className="px-4 pt-2">
              <div className="border-l-2 border-red-500 bg-red-50 rounded-r-lg px-2.5 py-1.5 relative">
                <div className="text-[9.5px] font-bold text-red-600 mb-0.5">✦ AI相談から引用</div>
                <div className="text-[10.5px] text-gray-600 leading-snug pr-5 max-h-12 overflow-hidden">{quote}</div>
                <button onClick={() => setQuote("")} title="引用を外す"
                  className="absolute top-1 right-1.5 text-gray-400 hover:text-gray-600 text-[11px]">✕</button>
              </div>
            </div>
          )}
          <Composer text={text} setText={setText} onSend={handleSend} sending={sending} />
        </>
      )}
    </div>
  );

  const aiPane = <AiConsultPane onQuoteToStaff={quoteToStaff} compact={!wide} />;

  // ── AI相談が無効なロールでは従来の1カラム表示に戻す ──
  if (!aiEnabled) {
    return (
      <div className="flex justify-center">
        <div className="w-full max-w-2xl flex flex-col h-[calc(100vh-140px)] min-h-[480px] bg-white border border-gray-200 rounded-xl overflow-hidden">
          {staffPane}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-140px)] min-h-[480px] bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* 1カラム時のセグメント切替 */}
      {!wide && (
        <div className="px-3 py-2 shrink-0 bg-gray-50 border-b border-gray-200">
          <div className="flex bg-gray-200/70 rounded-lg p-0.5">
            <button onClick={() => setPane("staff")}
              className={`flex-1 py-2 text-[13px] font-bold rounded-md flex items-center justify-center gap-1.5 min-h-[44px] ${pane === "staff" ? "bg-white text-gray-800 shadow-sm" : "text-gray-600"}`}>
              事務局
              {staffNew > 0 && pane !== "staff" && (
                <span className="text-[10px] bg-red-600 text-white rounded-full px-1.5 leading-4">{staffNew}</span>
              )}
            </button>
            <button onClick={() => setPane("ai")}
              className={`flex-1 py-2 text-[13px] font-extrabold rounded-md min-h-[44px] ${pane === "ai" ? "bg-white text-red-600 shadow-sm" : "text-gray-600"}`}>
              ✦ AIに相談
            </button>
          </div>
        </div>
      )}

      {wide ? (
        <div ref={splitRef} className="flex-1 flex min-h-0">
          <div className="min-w-0 border-r border-gray-200" style={{ width: `${ratio * 100}%` }}>{staffPane}</div>
          <div onMouseDown={startDrag} title="ドラッグで幅を調整"
            className="w-1.5 shrink-0 bg-gray-100 hover:bg-red-400 cursor-col-resize transition-colors" />
          <div className="flex-1 min-w-0">{aiPane}</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          {pane === "staff" ? staffPane : aiPane}

          {/* 反対ペインの新着トースト（スマホで「もう片方が動いていること」を見逃さない） */}
          {pane === "ai" && staffNew > 0 && (
            <button onClick={() => setPane("staff")}
              className="absolute left-3 right-3 bottom-[76px] bg-neutral-900 text-white rounded-xl px-3 py-2.5 text-[11.5px] font-bold flex items-center gap-2 shadow-lg">
              <span className="w-5 h-5 rounded-full bg-white/20 grid place-items-center text-[9px] shrink-0">運</span>
              <span className="flex-1 text-left truncate">事務局から新着メッセージ（{staffNew}件）</span>
              <span className="text-[10px] opacity-70 shrink-0">開く ▸</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
