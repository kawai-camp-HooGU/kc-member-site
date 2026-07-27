"use client";
// 会員連携の状態表示（トーク画面ヘッダー）。連携済みなら会員名＋解除、未連携ならバッジのみ。
//   ※ 連携フォーム送信はシナリオ配信・初回メッセージで行う。手動の名寄せ作業は「名寄せ」画面に集約。
import { useState } from "react";
import type { LineFriend } from "../../lib/models";

export interface LinkControlProps {
  friend: LineFriend;
  memberName: string;
  onUnlink: () => Promise<{ ok: boolean; error?: string }>;
}

export function LinkControl({ friend, memberName, onUnlink }: LinkControlProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const linked = friend.memberId != null;

  if (!linked) {
    return <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">未連携</span>;
  }

  const doUnlink = async () => {
    setBusy(true); setMsg("");
    const r = await onUnlink();
    setBusy(false);
    if (!r.ok) setMsg(r.error ?? "解除に失敗しました");
  };

  return (
    <span className="text-[11px] text-gray-600 inline-flex items-center gap-2 flex-wrap">
      <span className="font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
        会員 #{friend.memberId}{memberName ? ` ${memberName}` : ""} に連携済み
      </span>
      <button onClick={doUnlink} disabled={busy} className="text-red-600 underline disabled:opacity-50">解除</button>
      {msg && <span className="text-gray-400">{msg}</span>}
    </span>
  );
}
