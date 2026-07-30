"use client";
// ============================================================
// ⑤ 配信原稿生成サポートAI（一斉配信）
//   ・「AIチャットで原稿を作る」ボタンのみ（別タブで対話生成）。
//   ・目的/トーン/長さ/絵文字・3案生成・配信前チェックは廃止。
//   ・AIは送信しない。チャットで作った案が messageBody に入るだけ。
// ============================================================
import { openAiChat } from "../../lib/aiChat";
import type { BcTarget } from "../../lib/ai/types";

export interface AiBroadcastBarProps {
  target: BcTarget;
  /** 現在の本文（チャットの初期コンテキストに渡す） */
  messageBody: string;
  /** 案を本文へ反映 */
  onApply: (text: string) => void;
}

export function AiBroadcastBar({ target, messageBody, onApply }: AiBroadcastBarProps) {
  const launchChat = () => openAiChat({
    mode: "broadcast_draft",
    source: { screen: "一斉配信" },
    seed: { target, points: "", messageBody },
    onApply: (p) => { if (typeof p.text === "string") onApply(p.text); },
  });

  return (
    <div className="border border-red-200 bg-red-50 rounded-xl p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] font-extrabold text-red-700">✦ AIで配信原稿を生成</span>
      </div>
      <button onClick={launchChat}
        className="w-full flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-red-700">
        AIチャットで原稿を作る <span className="text-[10px] opacity-85">↗ 別タブ</span>
      </button>
    </div>
  );
}
