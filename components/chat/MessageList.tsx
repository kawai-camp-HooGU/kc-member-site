"use client";
// ============================================================
// メッセージ一覧
//   ・日付区切り
//   ・画像の署名URLは【このコンポーネントで一括発行】して各吹き出しへ配る
//     （添付ごとに発行すると履歴20件で20往復になるため）
//   ・ライトボックスの状態はここで1つだけ持つ
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatAttachment, ChatMessage, ChatSide } from "../../lib/models";
import { isImageAttachment } from "../../lib/attachments";
import { signedUrls } from "../../lib/chatStorage";
import { MessageBubble } from "./MessageBubble";
import { Lightbox } from "./Lightbox";
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
  /** ブックマーク操作（運営画面のみ） */
  onBookmark?: (m: ChatMessage) => void;
  /** ブックマーク済みメッセージID集合（★表示用） */
  bookmarkedIds?: Set<number>;
  /** 送信に失敗した未送信メッセージのID（負の仮ID） */
  failedIds?: Set<number>;
  onRetry?: (m: ChatMessage) => void;
  onDiscard?: (m: ChatMessage) => void;
}

interface LightboxState { images: ChatAttachment[]; index: number; }

export function MessageList({
  messages, outSide, whoLabel, emptyText, showOrigin, onReply, onBookmark, bookmarkedIds,
  failedIds, onRetry, onDiscard,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  // 表示に必要な画像パス（縮小版があればそちら）
  const imagePaths = useMemo(() => {
    const out: string[] = [];
    for (const m of messages) {
      for (const a of m.attachments) {
        if (isImageAttachment(a)) out.push(a.thumbPath ?? a.storagePath);
      }
    }
    return out;
  }, [messages]);

  // 署名URLを一括発行する。失効の手前で取り直せるよう、パスが変わるたびに引き直す。
  useEffect(() => {
    if (imagePaths.length === 0) { setUrls(new Map()); return; }
    let alive = true;
    signedUrls(imagePaths).then((m) => { if (alive) setUrls(m); }).catch(() => {});
    return () => { alive = false; };
  }, [imagePaths]);

  // 引用返信の元メッセージを引くための索引
  const byId = new Map(messages.map((m) => [m.id, m]));

  let lastDay = "";
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
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
              onBookmark={onBookmark} bookmarked={bookmarkedIds?.has(m.id) ?? false}
              urls={urls}
              onOpenImage={(images, index) => setLightbox({ images, index })}
              failed={failedIds?.has(m.id) ?? false}
              onRetry={onRetry} onDiscard={onDiscard}
              replyTo={m.replyToId != null ? byId.get(m.replyToId) ?? null : null} />
          </div>
        );
      })}
      <div ref={endRef} />

      {lightbox && (
        <Lightbox images={lightbox.images} index={lightbox.index}
          onIndexChange={(i) => setLightbox((s) => (s ? { ...s, index: i } : s))}
          onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
