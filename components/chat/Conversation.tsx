"use client";
import type { ChatThread, ChatMessage } from "../../lib/models";
import { avatarColor, initial, fmtTime, roleBadge } from "./chatUtils";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

export interface ConversationProps {
  thread: ChatThread;
  messages: ChatMessage[];
  text: string;
  setText: (v: string) => void;
  onSend: (body: string, files: File[]) => void;
  sending: boolean;
  onMarkRead: () => void;
  onOpenInfo: () => void;
  /** 引用返信 */
  replyTo: ChatMessage | null;
  onReply: (m: ChatMessage) => void;
  onCancelReply: () => void;
}

export function Conversation({
  thread, messages, text, setText, onSend, sending, onMarkRead, onOpenInfo,
  replyTo, onReply, onCancelReply,
}: ConversationProps) {
  const m = thread.member;
  const rb = roleBadge(m.role);
  const cleared = thread.unread === 0;
  return (
    <div className="flex-1 min-w-0 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
      <div className="px-5 py-2.5 bg-white border-b border-gray-200 flex items-center gap-3 shrink-0">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white font-bold" style={{ background: avatarColor(m.id) }}>{initial(m.name)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><b className="text-[15px] truncate">{m.name}</b><span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${rb.cls}`}>{rb.label}</span></div>
          <small className="text-gray-400 text-xs">最終 {fmtTime(thread.lastMessageAt) || "―"}</small>
        </div>
        <div className="ml-auto flex gap-2 shrink-0">
          <button onClick={onOpenInfo} className="text-xs font-bold text-gray-700 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:border-red-400 hover:text-red-500 whitespace-nowrap">👤 顧客情報</button>
          <button onClick={onMarkRead} disabled={cleared}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border whitespace-nowrap ${cleared ? "text-green-600 border-green-200 bg-green-50" : "text-red-600 border-red-500 bg-white hover:bg-red-50"}`}>
            {cleared ? "✓ 確認済" : "✓ メッセージ確認済"}
          </button>
        </div>
      </div>
      {/* 運営画面：送信元タグ・リンク訪問状況・返信ボタンを出す */}
      <MessageList messages={messages} outSide="staff" showOrigin onReply={onReply} />
      <Composer text={text} setText={setText} onSend={onSend} sending={sending}
        replyTo={replyTo ? { id: replyTo.id, body: replyTo.body } : null}
        onCancelReply={onCancelReply}
        placeholder="メッセージを入力…（AI回答案から採用も可・⌘/Ctrl+Enterで送信）" />
    </div>
  );
}
