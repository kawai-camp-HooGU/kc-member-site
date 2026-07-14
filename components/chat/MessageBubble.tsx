"use client";
// ============================================================
// メッセージ吹き出し
//
//   【配色】
//     人が書いた返信（origin=staff）… ブルー塗り（#378ADD）
//     会員の発言                     … 白＋枠線
//     自動配信（broadcast/scenario/action）
//                                    … **塗らない**。白地＋色付きタグ。
//       ⚠️ 手動と自動を同じ塗りにすると、運営が「これ自分が送ったんだっけ？」と迷う。
//       ⚠️ 会員画面ではタグを一切出さない（内部の仕組みを見せない）。showOrigin=false
//
//   【リンク】
//     本文中のURLは chat_links に登録済み。/api/chat/click 経由に張り替えて描画し、
//     運営画面には「訪問済／未訪問」を出す。
//
//   【リプライ】
//     replyToId があれば、引用元の抜粋を吹き出しの上に出す。
// ============================================================
import type { ChatMessage, ChatSide } from "../../lib/models";
import { chatClickUrl } from "../../lib/chat";
import { fmtTime } from "./chatUtils";
import { FileCard } from "./FileCard";
import { Icon } from "../common/Icon";

export interface MessageBubbleProps {
  message: ChatMessage;
  /** 右側（自分側）に表示する向き */
  outSide: ChatSide;
  /** 受信側に表示する送信者ラベル（メンバー画面の「事務局」等） */
  whoLabel?: string;
  /** 送信元タグ・リンク訪問状況を出すか（運営画面のみ true） */
  showOrigin?: boolean;
  /** 引用元メッセージ（削除済みなら null） */
  replyTo?: ChatMessage | null;
  /** 「↩ 返信」を押したとき（運営画面のみ） */
  onReply?: (m: ChatMessage) => void;
}

const ORIGIN_TAG: Record<string, { label: string; cls: string; icon: "broadcast" | "scenario" | "bell" }> = {
  broadcast: { label: "一斉配信", cls: "bg-[#EEEDFE] text-[#3C3489] border-[#CECBF6]", icon: "broadcast" },
  scenario:  { label: "シナリオ配信", cls: "bg-[#E1F5EE] text-[#085041] border-[#9FE1CB]", icon: "scenario" },
  action:    { label: "自動アクション", cls: "bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]", icon: "bell" },
};

/** 本文を描画する。URLは計測リンクに張り替える（登録済みのURLだけ）。 */
function Body({ message, out }: { message: ChatMessage; out: boolean }) {
  if (!message.body) return null;
  if (message.links.length === 0) return <span>{message.body}</span>;

  // 長いURLから順に置換（短いURLが長いURLの一部に含まれる場合の取り違えを防ぐ）
  const links = [...message.links].sort((a, b) => b.url.length - a.url.length);
  const parts: (string | { url: string; id: number })[] = [message.body];

  for (const l of links) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (typeof p !== "string" || !p.includes(l.url)) continue;
      const seg = p.split(l.url);
      const rebuilt: (string | { url: string; id: number })[] = [];
      seg.forEach((s, idx) => {
        if (idx > 0) rebuilt.push({ url: l.url, id: l.id });
        rebuilt.push(s);
      });
      parts.splice(i, 1, ...rebuilt);
    }
  }

  return (
    <span>
      {parts.map((p, i) =>
        typeof p === "string" ? <span key={i}>{p}</span> : (
          <a key={i} href={chatClickUrl(p.id)} target="_blank" rel="noopener noreferrer"
            className={`underline underline-offset-2 break-all ${out ? "text-white" : "text-blue-600"}`}>
            {p.url}
          </a>
        ),
      )}
    </span>
  );
}

export function MessageBubble({
  message, outSide, whoLabel, showOrigin = false, replyTo, onReply,
}: MessageBubbleProps) {
  const out = message.side === outSide;
  const auto = message.origin === "broadcast" || message.origin === "scenario" || message.origin === "action";
  const tag = showOrigin && auto ? ORIGIN_TAG[message.origin] : null;

  // 自動配信は「塗らない」。人が書いた返信だけブルーで塗る。
  const bubbleCls = !out
    ? "bg-white border border-gray-200 rounded-tl-sm"
    : tag
      ? "bg-white border border-gray-200 rounded-tr-sm"
      : "bg-[#378ADD] text-white rounded-tr-sm";
  const painted = out && !tag;

  return (
    <div className={`group flex mb-3 max-w-[76%] ${out ? "ml-auto flex-row-reverse" : ""}`}>
      <div className="min-w-0">
        {!out && whoLabel && <div className="text-[10.5px] text-gray-400 mb-0.5 px-2">{whoLabel}</div>}

        <div className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${bubbleCls}`}>
          {/* 送信元タグ（運営画面のみ・自動配信のみ） */}
          {tag && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border mb-1.5 ${tag.cls}`}>
              <Icon name={tag.icon} size={11} /> {tag.label}
            </span>
          )}

          {/* 引用返信 */}
          {message.replyToId != null && (
            <div className={`text-[11px] leading-relaxed rounded-r px-2 py-1 mb-1.5 border-l-[3px] ${
              painted ? "bg-white/20 border-white/60 text-white/90" : "bg-gray-100 border-gray-400 text-gray-500"}`}>
              {replyTo
                ? (replyTo.body.length > 40 ? `${replyTo.body.slice(0, 40)}…` : replyTo.body) || "（添付ファイル）"
                : "削除されたメッセージ"}
            </div>
          )}

          <Body message={message} out={painted} />

          {message.attachments.map((a) => (
            <div key={a.id} className={message.body ? "mt-2" : ""}>
              <FileCard attachment={a} out={painted} />
            </div>
          ))}
        </div>

        {/* リンクの訪問状況（運営画面のみ） */}
        {showOrigin && message.links.length > 0 && (
          <div className={`mt-1 space-y-0.5 ${out ? "text-right" : ""}`}>
            {message.links.map((l) => (
              <div key={l.id} className="text-[10.5px] inline-flex items-center gap-1 ml-2">
                {l.clickCount > 0 ? (
                  <span className="text-emerald-600 font-bold">
                    ✓ 訪問済（{l.clickCount}回・{fmtTime(l.lastClickAt)}）
                  </span>
                ) : (
                  <span className="text-gray-400">◦ リンク未訪問</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 mx-2 shrink-0 self-end">
        <span className="text-[10px] text-gray-400">{fmtTime(message.createdAt)}</span>
        {onReply && (
          <button onClick={() => onReply(message)} title="このメッセージに返信"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-gray-400 hover:text-blue-600">
            ↩ 返信
          </button>
        )}
      </div>
    </div>
  );
}
