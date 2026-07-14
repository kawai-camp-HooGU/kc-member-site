"use client";
import { useEffect, useRef } from "react";
import type { ChatMessage, ChatSide } from "../../lib/models";
import { MessageBubble } from "./MessageBubble";
import { dayKey, fmtDay } from "./chatUtils";

export interface MessageListProps {
  messages: ChatMessage[];
  outSide: ChatSide;
  whoLabel?: string;
  emptyText?: string;
  /** 送信元タグ・リンク訪問状況を出すか（運営画面のみ true） */
  showOrigin?: boolean;
  /** 「↩ 返信」（運営画面のみ） */
  onReply?: (m: ChatMessage) => void;
}

export function MessageList({ messages, outSide, whoLabel, emptyText, showOrigin, onReply }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  // 引用返信の元メッセージを引くための索引
  const byId = new Map(messages.map((m) => [m.id, m]));

  let lastDay = "";
  return (
    <div className="flex-1 overflow-y-auto px-5 py-2">
      {messages.length === 0 && (
        <p className="text-center text-xs text-gray-400 py-10">{emptyText ?? "メッセージはまだありません。"}</p>
      )}
      {messages.map((m) => {
        const dk = dayKey(m.createdAt);
        const sep = dk && dk !== lastDay;
        lastDay = dk;
        return (
          <div key={m.id}>
            {sep && <div className="text-center text-[11px] text-gray-400 my-3.5">{fmtDay(m.createdAt)}</div>}
            <MessageBubble message={m} outSide={outSide} whoLabel={whoLabel}
              showOrigin={showOrigin} onReply={onReply}
              replyTo={m.replyToId != null ? byId.get(m.replyToId) ?? null : null} />
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
