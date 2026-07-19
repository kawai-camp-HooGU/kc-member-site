"use client";
// ============================================================
// ④ コンテンツ本文HTML 生成サポートAI（起動ボタンのみ）
//   ・編集画面では対話・生成を行わない。別タブのAIチャットへ委譲する。
//   ・チャット側で「反映」された結果を onApply で受け取る。
//   ・生成／プレビュー／サニタイズ結果の表示はチャット画面側が担当。
// ============================================================
import { openAiChat } from "../../lib/aiChat";

export interface AiHtmlBarProps {
  /** 現在の bodyHtml（チャットへ渡す） */
  html: string;
  /** textarea の選択範囲（未選択なら null。部分修正のヒントとして渡す） */
  selection: { start: number; end: number } | null;
  /** 反映（確定） */
  onApply: (nextHtml: string) => void;
  /** 別タブAIチャットのヘッダーに出す呼び出し元画面名（既定: コンテンツ編集） */
  sourceScreen?: string;
}

export function AiHtmlBar({ html, selection, onApply, sourceScreen = "コンテンツ編集" }: AiHtmlBarProps) {
  const launchChat = () => openAiChat({
    mode: "html_generate",
    source: { screen: sourceScreen },
    seed: { html, selection },
    onApply: (p) => { if (typeof p.html === "string") onApply(p.html); },
  });

  return (
    <button onClick={launchChat}
      className="w-full mb-3 flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-bold py-2.5 rounded-lg hover:bg-red-700">
      ✦ AIチャットで生成・修正 <span className="text-[10px] opacity-85">／ 別ウィンドウ</span>
    </button>
  );
}
