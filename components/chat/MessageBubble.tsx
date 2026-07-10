"use client";
import type { ChatMessage, ChatSide } from "../../lib/models";
import { fmtTime } from "./chatUtils";
import { FileCard } from "./FileCard";

export interface MessageBubbleProps {
  message: ChatMessage;
  /** 右側（自分側）に表示する向き */
  outSide: ChatSide;
  /** 受信側に表示する送信者ラベル（メンバー画面の「事務局」等） */
  whoLabel?: string;
}

export function MessageBubble({ message, outSide, whoLabel }: MessageBubbleProps) {
  const out = message.side === outSide;
  return (
    <div className={`flex mb-3 max-w-[76%] ${out ? "ml-auto flex-row-reverse" : ""}`}>
      <div>
        {!out && whoLabel && <div className="text-[10.5px] text-gray-400 mb-0.5 px-2">{whoLabel}</div>}
        <div className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          out ? "bg-red-600 text-white rounded-tr-sm" : "bg-white border border-gray-200 rounded-tl-sm"}`}>
          {message.body && <span>{message.body}</span>}
          {message.attachments.map((a) => (
            <div key={a.id} className={message.body ? "mt-2" : ""}>
              <FileCard attachment={a} out={out} />
            </div>
          ))}
        </div>
      </div>
      <span className="text-[10px] text-gray-400 self-end mx-2 shrink-0">{fmtTime(message.createdAt)}</span>
    </div>
  );
}
