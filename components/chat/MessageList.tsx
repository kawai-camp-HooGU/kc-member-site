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
}

export function MessageList({ messages, outSide, whoLabel, emptyText }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

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
            <MessageBubble message={m} outSide={outSide} whoLabel={whoLabel} />
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
