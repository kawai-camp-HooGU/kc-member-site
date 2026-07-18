"use client";
// トークのブックマーク登録／解除モーダル（ジャンルだけ選ぶ。残りはAIが自動生成）
import { useState } from "react";
import { BOOKMARK_GENRES } from "../../lib/bookmarks";

export function BookmarkModal({
  originalText, alreadyBookmarked, busy, onSave, onDelete, onClose,
}: {
  originalText: string;
  alreadyBookmarked: boolean;
  busy: boolean;
  onSave: (genre: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [genre, setGenre] = useState<string>("説明");
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center">
          <b className="text-[15px] font-extrabold text-gray-800">★ ブックマーク{alreadyBookmarked ? "" : "に登録"}</b>
          <button onClick={onClose} className="ml-auto text-gray-400 text-lg leading-none">✕</button>
        </div>
        <div className="px-5 py-4">
          <div className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-4 max-h-28 overflow-y-auto whitespace-pre-wrap">{originalText || "（本文なし）"}</div>
          {alreadyBookmarked ? (
            <p className="text-[13px] text-gray-600">このメッセージは既にブックマーク済みです。解除しますか？</p>
          ) : (
            <>
              <div className="text-xs font-bold text-gray-500 mb-2">ジャンルを選択（あとはAIが自動生成）</div>
              <div className="flex flex-wrap gap-2">
                {BOOKMARK_GENRES.map((g) => (
                  <button key={g} type="button" onClick={() => setGenre(g)}
                    className={`text-[12px] font-bold px-3 py-1.5 rounded-full border transition-colors ${genre === g ? "bg-red-50 border-red-400 text-red-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{g}</button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">想定質問・検索キーワード・成型後案内例は登録後にAIが自動生成します（一覧の「編集」で修正できます）。</p>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2.5 items-center">
          {alreadyBookmarked && (
            <button onClick={onDelete} disabled={busy}
              className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40">
              {busy ? "処理中…" : "ブックマーク削除"}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          {!alreadyBookmarked && (
            <button onClick={() => onSave(genre)} disabled={busy}
              className="text-sm py-2 px-5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40">
              {busy ? "登録中…" : "登録する"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
