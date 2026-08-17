"use client";
// ============================================================
// ⑧ 扉ページHTML 生成サポートAI（起動ボタンのみ）
//   ・編集画面では対話・生成を行わない。別ウィンドウのAIチャットへ委譲する。
//   ・チャット側で「反映」された結果を onApply で受け取る。
//   ・本文用（AiHtmlBar）とは渡す seed が違う：
//       sectionId … サーバーが slug の正本を引くために必須（未保存=0 は不可）
//       pages     … チャット側のプレビュー（DoorPage）で使うページ一覧
// ============================================================
import { openAiChat } from "../../lib/aiChat";
import type { ContentPage } from "../../lib/models";

export interface AiDoorBarProps {
  /** 現在の door_html（チャットへ渡す） */
  html: string;
  /** 対象セクション。未保存（0）のときはボタンを無効化する */
  sectionId: number;
  /** このセクションに所属するページ（プレビューの解決に使う） */
  pages: ContentPage[];
  /** 反映（確定） */
  onApply: (nextHtml: string) => void;
  /** AIチャットのヘッダーに出す呼び出し元画面名 */
  sourceScreen?: string;
}

export function AiDoorBar({
  html, sectionId, pages, onApply, sourceScreen = "セクション管理（扉ページ）",
}: AiDoorBarProps) {
  const disabled = !sectionId;

  const launchChat = () => {
    if (disabled) return;
    openAiChat({
      mode: "door_generate",
      source: { screen: sourceScreen },
      seed: {
        html,
        sectionId,
        // ★ プレビュー用。DoorContext を組むのに必要な最小項目だけ渡す
        pages: pages.map((p) => ({ id: p.id, slug: p.slug, name: p.name, coverUrl: p.coverUrl })),
      },
      onApply: (p) => { if (typeof p.html === "string") onApply(p.html); },
    });
  };

  return (
    <div className="mb-1">
      <button onClick={launchChat} disabled={disabled}
        className="w-full flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-bold py-2.5 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-red-600">
        ✦ AIチャットで扉ページを生成・修正 <span className="text-[10px] opacity-85">／ 別ウィンドウ</span>
      </button>
      {disabled && (
        <p className="text-[10.5px] text-gray-400 mt-1 mb-0">
          セクションを一度保存すると使えます（ページの slug をサーバー側で参照するため）。
        </p>
      )}
    </div>
  );
}
