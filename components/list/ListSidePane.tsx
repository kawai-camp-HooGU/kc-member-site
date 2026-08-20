"use client";
// ============================================================
// リスト管理：左ペイン（リスト枠の一覧）
//   ・並び順は手動（ドラッグ＆ドロップ）。確定は親の onReorder（楽観更新）
//   ・各行に「メール可／電話のみ」の内訳を出し、配信できない件数を常に見せる
//
//   ⚠️ 検索で絞っている間は canReorder=false で来る。見えていない行を
//      巻き込んで並び順を壊すのを防ぐため、ドラッグを無効化する。
// ============================================================
import { useState } from "react";
import { Icon } from "../common/Icon";
import type { ContactList } from "../../lib/models";

export interface ListSidePaneProps {
  lists: ContactList[];
  /** 絞り込み前の総数（見出しの件数表示用） */
  allCount: number;
  selectedId: number | null;
  query: string;
  onQuery: (v: string) => void;
  canReorder: boolean;
  dragId: number | null;
  onDragId: (id: number | null) => void;
  onSelect: (id: number) => void;
  onReorder: (orderedIds: number[]) => void;
  onDuplicate: (l: ContactList) => void;
  onToggleArchive: (l: ContactList) => void;
  loading: boolean;
}

export function ListSidePane({
  lists, allCount, selectedId, query, onQuery, canReorder, dragId, onDragId,
  onSelect, onReorder, onDuplicate, onToggleArchive, loading,
}: ListSidePaneProps) {
  /** ドラッグ中に線を描く位置（この id の直前に入る） */
  const [overId, setOverId] = useState<number | null>(null);

  const selected = lists.find((l) => l.id === selectedId) ?? null;

  const handleDrop = (targetId: number) => {
    setOverId(null);
    const from = dragId;
    onDragId(null);
    if (from == null || from === targetId) return;
    const ids = lists.map((l) => l.id);
    const next = ids.filter((id) => id !== from);
    const at = next.indexOf(targetId);
    if (at < 0) return;
    next.splice(at, 0, from);
    onReorder(next);
  };

  /** 末尾へ落としたとき（リストの下の余白） */
  const handleDropLast = () => {
    setOverId(null);
    const from = dragId;
    onDragId(null);
    if (from == null) return;
    const next = lists.map((l) => l.id).filter((id) => id !== from);
    next.push(from);
    onReorder(next);
  };

  return (
    <div className="w-full md:w-[268px] shrink-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[38vh] md:max-h-none">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-[#3f3f46] text-white">
        <Icon name="layers" size={14} />
        <span className="text-[12px] font-bold">リスト</span>
        <span className="ml-auto text-[10px] text-gray-300">{allCount} 件</span>
      </div>

      <div className="shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
        <input value={query} onChange={(e) => onQuery(e.target.value)}
          placeholder="リスト名・説明で検索"
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11.5px] bg-gray-50
            focus:outline-none focus:bg-white focus:border-red-400" />
        <span className={`text-[10px] font-bold rounded-md px-2 py-1 border shrink-0 ${
          canReorder ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-400"}`}
          title={canReorder ? "ドラッグで並べ替えできます" : "検索中は並べ替えできません"}>
          手動並べ替え
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading && <p className="px-3 py-8 text-center text-[11.5px] text-gray-400">読み込み中...</p>}
        {!loading && lists.length === 0 && (
          <p className="px-3 py-8 text-center text-[11.5px] text-gray-400">
            {query.trim() ? "該当するリストはありません" : "リストがありません"}
          </p>
        )}

        {lists.map((l) => {
          const on = l.id === selectedId;
          const dragging = dragId === l.id;
          return (
            <div
              key={l.id}
              draggable={canReorder}
              onDragStart={() => onDragId(l.id)}
              onDragEnd={() => { onDragId(null); setOverId(null); }}
              onDragOver={(e) => { if (canReorder && dragId != null) { e.preventDefault(); setOverId(l.id); } }}
              onDrop={(e) => { if (canReorder) { e.preventDefault(); handleDrop(l.id); } }}
              onClick={() => onSelect(l.id)}
              className={`px-3 py-2 border-b border-gray-100 cursor-pointer transition-colors ${
                dragging ? "opacity-40" : on ? "bg-red-50 shadow-[inset_3px_0_0_#dc2626]" : "hover:bg-gray-50"
              } ${overId === l.id && !dragging ? "border-t-2 border-t-red-400" : ""} ${l.isArchived ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                {canReorder && (
                  <span className="shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
                    title="ドラッグで並べ替え" onClick={(e) => e.stopPropagation()}>
                    <Icon name="grid" size={13} />
                  </span>
                )}
                <span className="text-[12px] font-bold text-gray-700 truncate">{l.name}</span>
                {l.isArchived && (
                  <span className="shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-gray-400 text-white">
                    アーカイブ
                  </span>
                )}
                <span className={`ml-auto shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${
                  l.isArchived ? "bg-gray-100 text-gray-500" : "bg-red-100 text-red-700"}`}>
                  {l.entryCount.toLocaleString()}
                </span>
              </div>

              {l.description && (
                <p className="text-[10px] text-gray-500 truncate mt-0.5">{l.description}</p>
              )}

              <div className="flex gap-2 flex-wrap mt-0.5 text-[9.5px] text-gray-400">
                <span>メール可 {l.emailableCount.toLocaleString()}</span>
                <span className={l.phoneOnlyCount > 0 && l.emailableCount === 0 ? "text-amber-700 font-bold" : ""}>
                  電話のみ {l.phoneOnlyCount.toLocaleString()}
                </span>
                {!l.allowDelivery && <span className="text-gray-500">配信対象外</span>}
              </div>
            </div>
          );
        })}

        {/* 末尾へのドロップ領域（一番下へ動かすため） */}
        {canReorder && dragId != null && (
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleDropLast(); }}
            className="h-9 m-2 rounded-lg border-2 border-dashed border-red-300 bg-red-50/50
              flex items-center justify-center text-[10px] font-bold text-red-600">
            ここに落として一番下へ
          </div>
        )}
      </div>

      {/* 選択中リストへの操作 */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-2 border-t border-gray-100">
        <button onClick={() => selected && onDuplicate(selected)} disabled={!selected}
          className="text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600
            hover:bg-gray-50 disabled:opacity-40">複製</button>
        <button onClick={() => selected && onToggleArchive(selected)} disabled={!selected}
          className="ml-auto text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-red-200 text-red-700
            hover:bg-red-50 disabled:opacity-40">
          {selected?.isArchived ? "アーカイブ解除" : "アーカイブ"}
        </button>
      </div>
    </div>
  );
}
