"use client";
import type { ChatThread } from "../../lib/models";
import { avatarColor, initial, roleBadge } from "./chatUtils";

export interface CustomerInfoModalProps {
  thread: ChatThread;
  messageCount: number;
  assignedName: string;
  onClose: () => void;
}

export function CustomerInfoModal({ thread, messageCount, assignedName, onClose }: CustomerInfoModalProps) {
  const m = thread.member;
  const rb = roleBadge(m.role);
  const rows: [string, string][] = [
    ["会員ロール", rb.label],
    ["所属", m.company || "―"],
    ["メール", m.email || "―"],
    ["担当（社内）", assignedName || "未割当"],
    ["やり取り回数", `${messageCount} 通`],
    ["ChatWork ID", m.chatId || "―"],
  ];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-5" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <span className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-base" style={{ background: avatarColor(m.id) }}>{initial(m.name)}</span>
          <div><b className="text-base">{m.name}</b> <span className={`ml-1.5 align-middle text-[11px] px-2 py-0.5 rounded-full font-bold ${rb.cls}`}>{rb.label}</span></div>
          <button onClick={onClose} className="ml-auto text-xl text-gray-400 leading-none">✕</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-y-2 gap-x-5">
            {rows.map(([k, v]) => (
              <div key={k}><div className="text-[11px] text-gray-400">{k}</div><div className="text-[12.5px] font-semibold break-words">{v}</div></div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-4">※ ロール・所属・メールなどはメンバーマスタと連動します。変更は設定＞メンバーから行ってください。</p>
        </div>
      </div>
    </div>
  );
}
