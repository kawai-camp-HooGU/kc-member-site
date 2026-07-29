"use client";
// ============================================================
// FolderPane — 一覧画面の左に置く共通フォルダペイン（全画面共通）。
//   ・フォルダ選択（すべて / 各フォルダ）
//   ・作成（インライン入力）・名前変更・削除・共有
//   ・レコードのドラッグ&ドロップ受け入れ（onMoveRecord）
//
//   レコード側（右ペイン）は draggable な行にして、onDragStart で
//     e.dataTransfer.setData("text/plain", String(recordId))
//   をセットするだけでよい（FOLDER_DND_MIME を使うと確実）。
// ============================================================
import { useState } from "react";
import type { DragEvent } from "react";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { ShareFolderModal } from "./ShareFolderModal";
import { createFolder, renameFolder, deleteFolder } from "../../lib/folders";
import type { Folder, FolderScope } from "../../lib/folders";
import type { FolderSelection } from "../../hooks/useFolders";

/** ドラッグするレコードIDを載せる MIME（text/plain も併用する）*/
export const FOLDER_DND_MIME = "application/x-kawai-record-id";

export function FolderPane({
  scope, folders, loading, selected, onSelect,
  counts, total, myRole, canEdit, canManage, onChanged, onMoveRecord,
}: {
  scope: FolderScope;
  folders: Folder[];
  loading: boolean;
  selected: FolderSelection;
  onSelect: (s: FolderSelection) => void;
  /** フォルダID → レコード件数 */
  counts: Map<number, number>;
  /** 全件数（「すべて」に表示） */
  total: number;
  myRole?: string | null;
  canEdit: (folderId: number) => boolean;
  canManage: (folderId: number) => boolean;
  /** 作成・名前変更・削除・共有変更のあとに呼ぶ（フォルダ再読込） */
  onChanged: () => void;
  /** レコードをドロップしたとき（targetFolderId=null は「すべて」＝未分類へ） */
  onMoveRecord: (recordId: number, targetFolderId: number | null) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [menuId, setMenuId] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<Folder | null>(null);
  const [dropTarget, setDropTarget] = useState<FolderSelection | null>(null);

  // ── ドロップの受け皿 ──
  const readRecordId = (e: DragEvent): number | null => {
    const raw = e.dataTransfer.getData(FOLDER_DND_MIME) || e.dataTransfer.getData("text/plain");
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  };
  const allowDrop = (target: FolderSelection): boolean =>
    target === "all" ? true : canEdit(target as number);

  const onDragOver = (e: DragEvent, target: FolderSelection) => {
    if (!allowDrop(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };
  const onDrop = (e: DragEvent, target: FolderSelection) => {
    if (!allowDrop(target)) return;
    e.preventDefault();
    setDropTarget(null);
    const id = readRecordId(e);
    if (id == null) return;
    onMoveRecord(id, target === "all" ? null : (target as number));
  };

  // ── 作成 ──
  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    // myRole 未指定でも createFolder 側で current_role_key() を引いて解決する。
    const res = await createFolder(scope, name, myRole ?? null, folders.length);
    if (!res.ok) { toast.error(res.message); return; }
    setCreating(false); setNewName("");
    toast.success("フォルダを作成しました");
    onChanged();
  };

  // ── 名前変更 ──
  const submitRename = async (id: number) => {
    const name = renameText.trim();
    if (!name) { setRenamingId(null); return; }
    const res = await renameFolder(id, name);
    if (!res.ok) { toast.error(res.message); return; }
    setRenamingId(null);
    toast.success("フォルダ名を変更しました");
    onChanged();
  };

  // ── 削除 ──
  const remove = async (f: Folder) => {
    setMenuId(null);
    const ok = await confirm({
      title: "フォルダを削除",
      message: `「${f.name}」を削除します。中のレコードは削除されず「すべて（未分類）」に戻ります。`,
      confirmLabel: "削除する", danger: true,
    });
    if (!ok) return;
    const res = await deleteFolder(f.id, scope);
    if (!res.ok) { toast.error(res.message); return; }
    if (selected === f.id) onSelect("all");
    toast.success("フォルダを削除しました");
    onChanged();
  };

  // 案A：白カード＋色アイコン。行は共通スタイルを組み立てる。
  const rowBase = "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] cursor-pointer mb-0.5";
  const iconBox = (active: boolean) =>
    `w-[26px] h-[26px] rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-red-100 text-red-600" : "bg-amber-100 text-yellow-600"}`;
  // フォルダ名は2行まで折り返し（それ以上は…）。バッジ廃止で横幅を名前に回す。
  const nameCls = (active: boolean) =>
    `flex-1 min-w-0 text-[13.5px] leading-tight line-clamp-2 break-words ${active ? "text-red-600 font-extrabold" : "text-gray-700 font-semibold"}`;
  const cntCls = (active: boolean) =>
    `text-[11px] font-extrabold rounded-full min-w-[22px] h-[20px] px-1.5 inline-flex items-center justify-center shrink-0 ${active ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`;

  return (
    <aside className="w-[236px] shrink-0 self-stretch bg-white border-r border-gray-200 p-3.5 flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-1.5 pt-0.5 pb-2 mb-1.5 border-b border-gray-100">
        <Icon name="folder" size={15} className="text-yellow-500" />
        <span className="text-[12px] font-bold text-gray-700 tracking-wide">フォルダ</span>
        <span className="ml-auto text-[10.5px] text-gray-400 font-bold">全{total}件</span>
      </div>

      {/* フォルダ数が多い場合はこの領域だけ内部スクロール */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-0.5 px-0.5">
      {/* すべて */}
      <div
        onClick={() => onSelect("all")}
        onDragOver={(e) => onDragOver(e, "all")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDrop(e, "all")}
        className={`${rowBase} ${selected === "all" ? "bg-red-50" : "hover:bg-gray-50"} ${dropTarget === "all" ? "ring-2 ring-red-300" : ""}`}>
        {selected === "all" && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded bg-red-500" />}
        <span className={iconBox(selected === "all")}><Icon name="folder" size={15} /></span>
        <span className={nameCls(selected === "all")}>すべて</span>
        <span className={cntCls(selected === "all")}>{total}</span>
      </div>

      {loading && <div className="px-2.5 py-3 text-[12px] text-gray-400">読み込み中...</div>}

      {!loading && folders.map((f) => {
        const on = selected === f.id;
        const editable = canManage(f.id);
        return (
          <div key={f.id} className="relative">
            {renamingId === f.id ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <Icon name="folder" size={16} className="text-yellow-500" />
                <input autoFocus value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => submitRename(f.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitRename(f.id); if (e.key === "Escape") setRenamingId(null); }}
                  className="flex-1 min-w-0 text-[13px] border border-red-300 rounded-md px-1.5 py-0.5 outline-none" />
              </div>
            ) : (
              <div
                onClick={() => onSelect(f.id)}
                onDragOver={(e) => onDragOver(e, f.id)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => onDrop(e, f.id)}
                title={f.name}
                className={`${rowBase} ${on ? "bg-red-50" : "hover:bg-gray-50"} ${dropTarget === f.id ? "ring-2 ring-red-300 bg-red-50" : ""}`}>
                {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded bg-red-500" />}
                <span className={iconBox(on)}><Icon name="folder" size={15} /></span>
                <span className={nameCls(on)}>{f.name}</span>
                <span className={cntCls(on)}>{counts.get(f.id) ?? 0}</span>
                {editable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === f.id ? null : f.id); }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 px-0.5 leading-none shrink-0">⋯</button>
                )}
              </div>
            )}

            {/* ⋯メニュー */}
            {menuId === f.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                <div className="absolute right-1 top-8 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-32 text-[12.5px]">
                  <button onClick={() => { setMenuId(null); setRenamingId(f.id); setRenameText(f.name); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700">名前を変更</button>
                  <button onClick={() => { setMenuId(null); setShareTarget(f); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center gap-1.5">
                    <Icon name="users" size={13} /> 共有…</button>
                  <button onClick={() => remove(f)}
                    className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-1.5">
                    <Icon name="trash" size={13} /> 削除</button>
                </div>
              </>
            )}
          </div>
        );
      })}
      </div>

      {/* 作成 */}
      {creating ? (
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 mt-2">
          <Icon name="folder" size={16} className="text-yellow-500" />
          <input autoFocus value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={submitCreate}
            onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            placeholder="フォルダ名"
            className="flex-1 min-w-0 text-[13px] border border-red-300 rounded-md px-1.5 py-0.5 outline-none" />
        </div>
      ) : (
        <button onClick={() => setCreating(true)}
          className="shrink-0 w-full flex items-center justify-center gap-2 px-2.5 py-2 mt-2 rounded-[10px] border border-dashed border-gray-300 text-[12.5px] font-bold text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50">
          <Icon name="folder" size={14} /> ＋ フォルダを作成
        </button>
      )}

      <p className="shrink-0 text-[10px] text-gray-400 leading-snug px-2 pt-2.5">
        行をフォルダへドラッグすると移動できます。
      </p>

      {shareTarget && (
        <ShareFolderModal
          folder={shareTarget}
          onClose={() => setShareTarget(null)}
          onSaved={onChanged}
        />
      )}
    </aside>
  );
}
