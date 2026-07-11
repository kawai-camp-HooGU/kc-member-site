"use client";
// スタッフ画面（管理者・オペレーター）：顧客一覧＋会話＋AI相談チャット（3カラム）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import type { ChatThread, ChatMessage } from "../lib/models";
import { fetchThreads, fetchMessages, sendMessage, markStaffRead } from "../lib/chat";
import { CustomerList } from "../components/chat/CustomerList";
import { Conversation } from "../components/chat/Conversation";
import { AiPanel } from "../components/chat/AiPanel";
import { CustomerInfoModal } from "../components/chat/CustomerInfoModal";
import { SearchModal } from "../components/chat/SearchModal";

/** AI案に残った [要確認: 〜] をそのまま送ろうとしていないか */
const NEEDS_INPUT_RE = /\[要確認:[^\]]*\]/;

export function ChatView() {
  const { members, permission, can } = useMaster();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // AI案の反映フィードバック（元に戻す用）
  const [adopted, setAdopted] = useState<{ prev: string } | null>(null);
  const selectedRef = useRef<number | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  const loadThreads = useCallback(async () => {
    const t = await fetchThreads(members);
    setThreads(t);
    setSelectedId((cur) => cur ?? (t.length > 0 ? t[0].conversationId : null));
  }, [members]);

  const loadMessages = useCallback(async (cid: number) => {
    setMessages(await fetchMessages(cid));
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (selectedId != null) loadMessages(selectedId); }, [selectedId, loadMessages]);
  // 顧客を切り替えたら入力欄と反映フィードバックをリセット
  useEffect(() => { setText(""); setAdopted(null); }, [selectedId]);

  // Realtime：メッセージ・会話の変化で一覧と選択中の会話を更新
  useEffect(() => {
    const ch = supabase.channel("realtime-chat-staff")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (p) => {
        const row = (p.new ?? p.old) as { conversation_id?: number };
        loadThreads();
        if (row?.conversation_id && row.conversation_id === selectedRef.current) loadMessages(row.conversation_id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => loadThreads())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadThreads, loadMessages]);

  const selected = useMemo(() => threads.find((t) => t.conversationId === selectedId) ?? null, [threads, selectedId]);

  const handleSend = async (body: string, files: File[]) => {
    if (selectedId == null) return;
    // ★ AI案の [要確認] を埋めずに送ろうとしたら確認する（誤情報の送信防止）
    if (NEEDS_INPUT_RE.test(body)) {
      const ok = window.confirm(
        "本文に [要確認: …] が残っています。\nAIが確定できなかった箇所です。このまま送信しますか？",
      );
      if (!ok) return;
    }
    setSending(true);
    const msg = await sendMessage({ conversationId: selectedId, senderMemberId: permission.myId, side: "staff", body, files });
    setSending(false);
    if (msg) { setText(""); setAdopted(null); setMessages((prev) => [...prev, msg]); loadThreads(); }
  };

  const handleMarkRead = async () => {
    if (selectedId == null) return;
    await markStaffRead(selectedId);
    setThreads((prev) => prev.map((t) => t.conversationId === selectedId ? { ...t, unread: 0, staffLastReadAt: new Date().toISOString() } : t));
  };

  /** AI案を入力欄へ反映（送信はしない。直前の内容は「元に戻す」で復元できる） */
  const adopt = (t: string) => {
    setAdopted({ prev: text });
    setText(t);
  };
  const undoAdopt = () => {
    if (!adopted) return;
    setText(adopted.prev);
    setAdopted(null);
  };

  const assignedName = useMemo(() => {
    if (!selected?.assignedTo) return "";
    return members.find((m) => m.id === selected.assignedTo)?.name ?? "";
  }, [selected, members]);

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[520px] rounded-xl overflow-hidden border border-gray-200 bg-white -mx-2">
      <CustomerList threads={threads} selectedId={selectedId} onSelect={setSelectedId} onOpenSearch={() => setShowSearch(true)} />
      {selected ? (
        <div className="flex-1 min-w-0 flex flex-col">
          <Conversation thread={selected} messages={messages} text={text} setText={setText}
            onSend={handleSend} sending={sending} onMarkRead={handleMarkRead} onOpenInfo={() => setShowInfo(true)} />
          {adopted && (
            <div className="px-4 py-1.5 flex items-center gap-1.5 border-t border-gray-100 bg-white shrink-0">
              <span className="text-[10px] text-red-600 font-bold">✦ AIの案を入力欄に反映しました</span>
              <span className="text-[10px] text-gray-400">— 内容を確認して送信してください</span>
              <button onClick={undoAdopt} className="ml-auto text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                元に戻す
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 grid place-items-center text-sm text-gray-400 border-r border-gray-200">会話を選択してください</div>
      )}
      {can("ai") && <AiPanel conversationId={selectedId} draftText={text} onAdopt={adopt} />}

      {showInfo && selected && (
        <CustomerInfoModal thread={selected} messageCount={messages.length} assignedName={assignedName} onClose={() => setShowInfo(false)} />
      )}
      {showSearch && (
        <SearchModal threads={threads} onClose={() => setShowSearch(false)}
          onSelect={(cid) => { setSelectedId(cid); setShowSearch(false); }} />
      )}
    </div>
  );
}
