"use client";
// メンバー画面（顧客）：事務局とのやり取り欄のみ（1カラム）
import { useCallback, useEffect, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import type { ChatMessage } from "../lib/models";
import { fetchMessages, sendMessage, getOrCreateMyConversation, markMemberRead } from "../lib/chat";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";

export function MemberChatView() {
  const { permission } = useMaster();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const cidRef = useRef<number | null>(null);
  useEffect(() => { cidRef.current = conversationId; }, [conversationId]);

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

  useEffect(() => {
    if (conversationId == null) return;
    const ch = supabase.channel("realtime-chat-member")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (p) => {
        const row = (p.new ?? p.old) as { conversation_id?: number };
        if (row?.conversation_id === cidRef.current) reload(row.conversation_id);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, reload]);

  const handleSend = async (body: string, files: File[]) => {
    if (conversationId == null) return;
    setSending(true);
    const msg = await sendMessage({ conversationId, senderMemberId: permission.myId, side: "member", body, files });
    setSending(false);
    if (msg) { setText(""); setMessages((prev) => [...prev, msg]); }
  };

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-2xl flex flex-col h-[calc(100vh-140px)] min-h-[480px] bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2.5 shrink-0">
          <span className="w-9 h-9 rounded-full bg-neutral-900 text-white grid place-items-center font-bold text-xs">運</span>
          <div><b className="text-sm">KAWAI CAMP 事務局</b><small className="block text-gray-400 text-[11.5px]">運営スタッフ（管理者・オペレーター）とやり取りできます</small></div>
        </div>
        {!ready ? (
          <div className="flex-1 grid place-items-center text-sm text-gray-400">読み込み中…</div>
        ) : conversationId == null ? (
          <div className="flex-1 grid place-items-center text-sm text-gray-400 px-6 text-center">チャットを開始できませんでした。アカウントの紐づけをご確認ください。</div>
        ) : (
          <>
            <MessageList messages={messages} outSide="member" whoLabel="事務局" emptyText="事務局とのやり取りがここに表示されます。" />
            <Composer text={text} setText={setText} onSend={handleSend} sending={sending} />
          </>
        )}
      </div>
    </div>
  );
}
