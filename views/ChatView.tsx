"use client";
// スタッフ画面（管理者・オペレーター）：顧客一覧＋会話＋AI相談チャット（3カラム）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { useRoute } from "../hooks/useRoute";
import { supabase } from "../lib/supabase";
import type { ChatThread, ChatMessage } from "../lib/models";
import { fetchThreads, fetchMessages, sendMessage, markStaffRead } from "../lib/chat";
import { CustomerList } from "../components/chat/CustomerList";
import { Conversation } from "../components/chat/Conversation";
import { AiPanel } from "../components/chat/AiPanel";
import { SearchModal } from "../components/chat/SearchModal";
import { BookmarkModal } from "../components/chat/BookmarkModal";
import { createBookmark, deleteBookmarkByMessage, fetchBookmarkedMessageIds } from "../lib/bookmarks";
import { useConfirm } from "../components/common/ConfirmProvider";
import { openChildWindow } from "../lib/childWindow";

/** AI案に残った [要確認: 〜] をそのまま送ろうとしていないか */
const NEEDS_INPUT_RE = /\[要確認:[^\]]*\]/;

export function ChatView() {
  const confirm = useConfirm();
  const { members, permission, can } = useMaster();
  const [aiOpen, setAiOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  // 開いている会話は URL に載せる（/ops/chat/{conversationId}）
  const route = useRoute();
  const selectedId = route.detail[0] ? Number(route.detail[0]) : null;
  const setSelectedId = (id: number | null) => route.goDetail(id == null ? [] : [id]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  /** 引用返信の対象メッセージ（null＝通常送信） */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** ブックマーク：対象メッセージ・処理中・会話内のブックマーク済みID */
  const [bmTarget, setBmTarget] = useState<ChatMessage | null>(null);
  const [bmBusy, setBmBusy] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());
  // AI案の反映フィードバック（元に戻す用）
  const [adopted, setAdopted] = useState<{ prev: string } | null>(null);
  const selectedRef = useRef<number | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  // 会話を切り替えたら引用返信は解除する（別の会話に引用が残ると誤送信になる）
  useEffect(() => { setReplyTo(null); }, [selectedId]);

  const loadThreads = useCallback(async () => {
    const t = await fetchThreads(members);
    setThreads(t);
    if (selectedRef.current == null && t.length > 0) setSelectedId(t[0].conversationId);
  }, [members]);

  const loadMessages = useCallback(async (cid: number) => {
    setMessages(await fetchMessages(cid));
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (selectedId != null) loadMessages(selectedId); }, [selectedId, loadMessages]);
  // 顧客を切り替えたら入力欄と反映フィードバックをリセット
  useEffect(() => { setText(""); setAdopted(null); }, [selectedId]);
  // 会話ごとのブックマーク済みメッセージID（★表示用）
  useEffect(() => {
    if (selectedId == null) { setBookmarkedIds(new Set()); return; }
    fetchBookmarkedMessageIds(selectedId).then(setBookmarkedIds).catch(() => {});
  }, [selectedId]);

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

  // ── ブックマーク ──
  const openBookmark = (m: ChatMessage) => setBmTarget(m);
  const saveBookmark = async (genre: string) => {
    if (!bmTarget || selectedId == null) return;
    const target = bmTarget;
    setBmBusy(true);
    const r = await createBookmark({
      sourceMessageId: target.id, sourceConversationId: selectedId,
      sourceMemberId: selected?.member.id ?? null, sourceMessageAt: target.createdAt,
      originalText: target.body, genre,
    });
    setBmBusy(false);
    if (r.ok) { setBookmarkedIds((s) => new Set(s).add(target.id)); setBmTarget(null); }
    else alert(r.error ?? "登録に失敗しました");
  };
  const removeBookmark = async () => {
    if (!bmTarget) return;
    const target = bmTarget;
    setBmBusy(true);
    await deleteBookmarkByMessage(target.id);
    setBmBusy(false);
    setBookmarkedIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
    setBmTarget(null);
  };

  const handleSend = async (body: string, files: File[]) => {
    if (selectedId == null) return;
    // ★ AI案の [要確認] を埋めずに送ろうとしたら確認する（誤情報の送信防止）
    if (NEEDS_INPUT_RE.test(body)) {
      const ok = await confirm({
        title: "未確定の箇所があります",
        message: "本文に [要確認: …] が残っています。\nAIが確定できなかった箇所です。このまま送信しますか？",
        confirmLabel: "このまま送信",
      });
      if (!ok) return;
    }
    setSending(true);
    const msg = await sendMessage({
      conversationId: selectedId, senderMemberId: permission.myId, side: "staff", body, files,
      replyToId: replyTo?.id ?? null,
    });
    setSending(false);
    if (msg) {
      setText(""); setAdopted(null); setReplyTo(null);
      setMessages((prev) => [...prev, msg]);
      loadThreads();
    }
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

  /**
   * 顧客情報は「メンバー詳細画面」（1画面）へ。
   *   モーダル（CustomerInfoModal）は廃止し、設定＞メンバー一覧の「編集」と同じく
   *   /ops/members/[id] を新規ウィンドウで開く。
   *   参照: docs/メンバー詳細画面_改修メモ.md
   */
  const openMemberDetail = () => {
    if (!selected) return;
    // ⚠️ noopener は付けない（子側で「呼び出し元へ戻る」ために opener が要る）
    openChildWindow(`/ops/members/${selected.member.id}`, `member-${selected.member.id}`);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[520px] rounded-xl overflow-hidden border border-gray-200 bg-white -mx-2 relative">
      {/* 顧客リスト：狭幅では会話を開くと隠す（xl以上は常時表示） */}
      <div className={`${selectedId != null ? "hidden xl:block" : "block"} w-full xl:w-72 shrink-0 h-full`}>
        <CustomerList threads={threads} selectedId={selectedId} onSelect={setSelectedId} onOpenSearch={() => setShowSearch(true)} />
      </div>

      {/* 会話：狭幅では未選択時に隠す */}
      {selected ? (
        <div className={`${selectedId == null ? "hidden xl:flex" : "flex"} flex-1 min-w-0 flex-col`}>
          {/* 狭幅専用ヘッダ：一覧へ戻る／AIアシスタントを開く */}
          <div className="xl:hidden flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 bg-white shrink-0">
            <button onClick={() => setSelectedId(null)} className="text-sm text-gray-600 hover:text-red-600 font-medium">← 一覧</button>
            {can("ai") && (
              <button onClick={() => setAiOpen(true)} className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-500">✦ AIアシスタント</button>
            )}
          </div>
          <Conversation thread={selected} messages={messages} text={text} setText={setText}
            onSend={handleSend} sending={sending} onMarkRead={handleMarkRead} onOpenInfo={openMemberDetail}
            replyTo={replyTo} onReply={setReplyTo} onCancelReply={() => setReplyTo(null)}
            onBookmark={openBookmark} bookmarkedIds={bookmarkedIds} />
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
        <div className="hidden xl:grid flex-1 place-items-center text-sm text-gray-400 border-r border-gray-200">会話を選択してください</div>
      )}

      {/* AIパネル：xl以上は右にインライン、xl未満はドロワー（1回だけマウント） */}
      {can("ai") && (
        <>
          {aiOpen && <div className="xl:hidden fixed inset-0 bg-black/40 z-[59]" onClick={() => setAiOpen(false)} />}
          <div className={`${aiOpen ? "flex" : "hidden"} xl:flex fixed xl:static top-0 right-0 h-full z-[60] xl:z-auto shadow-2xl xl:shadow-none`}>
            <div className="xl:hidden absolute -left-9 top-2">
              <button onClick={() => setAiOpen(false)} className="w-8 h-8 rounded-full bg-white shadow border border-gray-200 text-gray-500">×</button>
            </div>
            <AiPanel conversationId={selectedId} draftText={text} onAdopt={adopt} />
          </div>
        </>
      )}

      {showSearch && (
        <SearchModal threads={threads} onClose={() => setShowSearch(false)}
          onSelect={(cid) => { setSelectedId(cid); setShowSearch(false); }} />
      )}

      {bmTarget && (
        <BookmarkModal originalText={bmTarget.body}
          alreadyBookmarked={bookmarkedIds.has(bmTarget.id)} busy={bmBusy}
          onSave={saveBookmark} onDelete={removeBookmark} onClose={() => setBmTarget(null)} />
      )}
    </div>
  );
}
