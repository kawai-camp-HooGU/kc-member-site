"use client";
// LINEトークの中央カラム：ヘッダ＋メッセージ＋入力欄。
//   ・ファイル送信ボタンは出さない（LINE仕様で送信不可）。
//   ・送信は Push 1通としてカウントされる注記を出す。
import { useEffect, useRef, useState } from "react";
import type { LineFriend, LineMessage } from "../../lib/models";
import { avatarColor, initial, fmtTime, fmtDay, statusStyle } from "./lineUtils";
import { fetchLineMediaUrl } from "../../lib/line";

export interface LineConversationProps {
  friend: LineFriend | null;
  messages: LineMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  onMarkRead: () => void;
}

function MediaBubble({ message }: { message: LineMessage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canView = message.mediaStatus === "stored";

  const open = async () => {
    if (!canView || loading) return;
    setLoading(true);
    const u = await fetchLineMediaUrl(message.id);
    setUrl(u);
    setLoading(false);
    if (u) window.open(u, "_blank", "noopener");
  };

  if (message.msgType === "image" && url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="受信画像" className="max-w-[180px] rounded-xl" />;
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

export function LineConversation({ friend, messages, sending, onSend, onMarkRead }: LineConversationProps) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

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
        <span
          className="w-9 h-9 rounded-full grid place-items-center text-white font-bold flex-shrink-0"
          style={{ background: avatarColor(friend.lineUserId || name) }}
        >
          {initial(name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <b className="text-sm truncate">{name}</b>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
            <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {friend.memberId != null ? `会員 #${friend.memberId}` : "未連携"}
          </div>
        </div>
        <button
          onClick={onMarkRead}
          className="ml-auto text-xs font-bold text-emerald-700 border border-emerald-600 bg-white px-3 py-1.5 rounded-lg hover:bg-emerald-50"
        >
          確認済にする
        </button>
      </div>

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
                <span className="text-[9.5px] text-slate-600 whitespace-nowrap">{fmtTime(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* 入力欄 */}
      <div className="border-t border-gray-200 bg-white px-4 py-2.5">
        <div className="flex gap-2 items-end">
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
          この送信は <b className="text-gray-800">Pushメッセージ1通</b> としてカウントされます／ファイル(PDF等)の送信はLINE仕様上できません
        </div>
      </div>
    </div>
  );
}
