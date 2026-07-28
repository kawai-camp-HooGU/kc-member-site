"use client";
// LINEトークの中央カラム：ヘッダ＋メッセージ＋入力欄。
//   ・ファイル送信ボタンは出さない（LINE仕様で送信不可）。
//   ・送信は Push 1通としてカウントされる注記を出す。
import { useEffect, useRef, useState } from "react";
import type { LineFriend, LineMessage } from "../../lib/models";
import { useState as useLocalState } from "react";
import { fmtTime, fmtDay, statusStyle } from "./lineUtils";
import { FriendAvatar } from "./FriendAvatar";
import { LinkControl } from "./LinkControl";
import { LineCustomerDetailModal } from "./LineCustomerDetailModal";
import { fetchLineMediaUrl } from "../../lib/line";
import type { Member } from "../../lib/models";

export interface LineConversationProps {
  friend: LineFriend | null;
  messages: LineMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  onSendMedia?: (file: File) => Promise<void>;
  onMarkRead: () => void;
  // ── 会員連携（Phase 2）──
  memberName?: string;
  member?: Member | null;
  onUnlink?: () => Promise<{ ok: boolean; error?: string }>;
  // ── 入力欄の外部制御（AI反映用・Phase 3）──
  text?: string;
  onTextChange?: (v: string) => void;
  // ── ブックマーク（Phase 3）──
  bookmarkedIds?: Set<number>;
  onBookmark?: (m: LineMessage) => void;
}

const HTTP_RE = /^https?:\/\//;

function MediaBubble({ message }: { message: LineMessage }) {
  // 送信メディアは media_path に公開URLをそのまま格納（http…）。受信は署名URLを都度発行。
  const direct = message.mediaPath && HTTP_RE.test(message.mediaPath) ? message.mediaPath : null;
  const [url, setUrl] = useState<string | null>(direct);
  const [loading, setLoading] = useState(false);
  const canView = direct != null || message.mediaStatus === "stored";

  const open = async () => {
    if (url) { window.open(url, "_blank", "noopener"); return; }
    if (!canView || loading) return;
    setLoading(true);
    const u = await fetchLineMediaUrl(message.id);
    setUrl(u);
    setLoading(false);
    if (u) window.open(u, "_blank", "noopener");
  };

  if (message.msgType === "image" && url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <button onClick={() => window.open(url, "_blank", "noopener")} className="block">
        <img src={url} alt="画像" className="max-w-[180px] rounded-xl" />
      </button>
    );
  }
  return (
    <button
      onClick={open}
      disabled={!canView || loading}
      className="flex items-center gap-2 disabled:opacity-60"
    >
      <span className="w-8 h-8 rounded-lg bg-white/20 grid place-items-center text-xs font-bold">
        {message.msgType === "image" ? "IMG" : message.msgType === "video" ? "VID" : "FILE"}
      </span>
      <span className="text-xs">
        {message.body}
        {message.mediaStatus === "pending" && "（取得中）"}
        {message.mediaStatus === "failed" && "（取得失敗）"}
        {canView && "（開く）"}
      </span>
    </button>
  );
}

export function LineConversation({
  friend, messages, sending, onSend, onSendMedia, onMarkRead,
  memberName = "", member = null, onUnlink,
  text: controlledText, onTextChange, bookmarkedIds, onBookmark,
}: LineConversationProps) {
  const [innerText, setInnerText] = useState("");
  const text = controlledText !== undefined ? controlledText : innerText;
  const setText = (v: string) => { if (onTextChange) onTextChange(v); else setInnerText(v); };
  const [uploading, setUploading] = useState(false);
  const [showInfo, setShowInfo] = useLocalState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setText(""); }, [friend?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  if (!friend) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-gray-400 bg-gray-100">
        左の一覧から友だちを選んでください
      </div>
    );
  }

  const name = friend.displayName || "(名称未取得)";
  const st = statusStyle(friend.status);
  const canSend = friend.status === "friend";

  const submit = () => {
    const t = text.trim();
    if (!t || sending || !canSend) return;
    onSend(t);
    setText("");
  };

  // 日付が変わるところに見出しを差す
  let lastDay = "";

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#8cabd8]/40">
      {/* ヘッダ */}
      <div className="px-4 py-2.5 bg-white border-b border-gray-200 flex items-center gap-3">
        <FriendAvatar name={name} pictureUrl={friend.pictureUrl} seed={friend.lineUserId} size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <b className="text-sm truncate">{name}</b>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
            <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <div className="mt-0.5">
            {onUnlink ? (
              <LinkControl friend={friend} memberName={memberName} onUnlink={onUnlink} />
            ) : (
              <span className="text-[11px] text-gray-500">{friend.memberId != null ? `会員 #${friend.memberId}` : "未連携"}</span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowInfo(true)}
            className="text-xs font-bold text-gray-700 border border-gray-300 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            顧客情報
          </button>
          <button
            onClick={onMarkRead}
            className="text-xs font-bold text-emerald-700 border border-emerald-600 bg-white px-3 py-1.5 rounded-lg hover:bg-emerald-50"
          >
            確認済にする
          </button>
        </div>
      </div>

      {showInfo && <LineCustomerDetailModal friend={friend} onClose={() => setShowInfo(false)} />}

      {/* メッセージ */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.map((m) => {
          const day = fmtDay(m.createdAt);
          const showDay = day && day !== lastDay;
          if (showDay) lastDay = day;
          const out = m.direction === "out";
          const isMedia = m.msgType === "image" || m.msgType === "video" || m.msgType === "audio" || m.msgType === "file";
          return (
            <div key={m.id}>
              {showDay && (
                <div className="text-center text-[10.5px] text-slate-700 my-3">
                  <span className="bg-white/50 rounded-full px-3 py-0.5">{day}</span>
                </div>
              )}
              <div className={`flex mb-2.5 max-w-[80%] items-end gap-1.5 ${out ? "ml-auto flex-row-reverse" : ""}`}>
                <div
                  className={`px-3 py-2 text-[13px] rounded-2xl ${
                    out ? "bg-emerald-500 text-white rounded-tr-sm" : "bg-white rounded-tl-sm"
                  }`}
                >
                  {isMedia ? <MediaBubble message={m} /> : m.body}
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9.5px] text-slate-600 whitespace-nowrap">{fmtTime(m.createdAt)}</span>
                  {onBookmark && !isMedia && m.body && (
                    <button
                      onClick={() => onBookmark(m)}
                      title={bookmarkedIds?.has(m.id) ? "ブックマーク済み" : "ブックマークに登録"}
                      className={`text-[13px] leading-none ${bookmarkedIds?.has(m.id) ? "text-amber-500" : "text-slate-400 hover:text-amber-500"}`}
                    >
                      {bookmarkedIds?.has(m.id) ? "★" : "☆"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* 入力欄 */}
      <div className="border-t border-gray-200 bg-white px-4 py-2.5">
        <div className="flex gap-2 items-end">
          {/* 画像・動画の添付 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,video/mp4"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f && onSendMedia) { setUploading(true); await onSendMedia(f); setUploading(false); }
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!canSend || uploading || sending}
            title="画像・動画を送信"
            className="w-[38px] h-[38px] flex-shrink-0 grid place-items-center border border-gray-200 rounded-xl text-gray-500 hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-50"
          >
            {uploading ? "…" : "🖼"}
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
            placeholder={canSend ? "メッセージを入力…（Ctrl+Enterで送信）" : "ブロック等のため送信できません"}
            disabled={!canSend}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[13px] resize-none min-h-[52px] max-h-[120px] bg-gray-50 disabled:opacity-60"
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending || !canSend}
            className="bg-emerald-500 text-white font-bold rounded-xl px-4 h-[38px] text-[13px] disabled:opacity-50"
          >
            {sending ? "送信中" : "送信"}
          </button>
        </div>
        <div className="text-[10.5px] text-gray-500 mt-1.5">
          この送信は <b className="text-gray-800">Pushメッセージ1通</b> としてカウントされます／画像(JPEG/PNG)・動画(mp4)を送信できます。PDF等のファイルはLINE仕様上送れません
        </div>
      </div>
    </div>
  );
}
