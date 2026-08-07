"use client";
// ============================================================
// ShareFolderModal — フォルダの公開範囲（ロール単位）を編集するダイアログ。
//   Google ドライブの共有管理のイメージ。
//     ・非公開   … 作成者ロールのみ（＋管理者）
//     ・ロール指定 … 選んだ運営ロールに共有（編集可 / 閲覧のみ）
//     ・全体公開  … 全運営ロール
//   作成者ロールは常にオーナー（デフォルト共有）。管理者は常にオーナー。
// ============================================================
import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";
import { allRoles, isStaffRole, roleLabel } from "../../lib/roles";
import { saveFolderSharing, createFolder } from "../../lib/folders";
import type { Folder, FolderScope, FolderVisibility, FolderAccess, FolderShare } from "../../lib/folders";

const ADMIN_ROLE = "管理者";

/**
 * フォルダの共有ダイアログ。2モード。
 *   ・編集モード：folder を渡す。既存フォルダの公開範囲・共有を編集。
 *   ・作成モード：folder を渡さず scope + myRole を渡す。名前入力つきで新規作成。
 *     公開範囲の初期値は「全運営に公開（public）」。
 */
export function ShareFolderModal({
  folder, scope, myRole, onClose, onSaved,
}: {
  folder?: Folder;
  scope?: FolderScope;
  myRole?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isCreate = !folder;
  // 作成者ロール（＝オーナー）。編集時は folder から、作成時は myRole から。
  const ownerRole = folder?.ownerRole ?? (myRole ?? "");

  const [name, setName] = useState(folder?.name ?? "");
  // 作成時の初期公開範囲は「全運営に公開」。編集時は既存値。
  const [visibility, setVisibility] = useState<FolderVisibility>(folder?.visibility ?? "public");
  // 追加共有ロール（作成者ロール・管理者は除く）→ access
  const [shareMap, setShareMap] = useState<Map<string, FolderAccess>>(
    () => new Map((folder?.shares ?? []).filter((s) => s.roleKey !== ownerRole && s.roleKey !== ADMIN_ROLE).map((s) => [s.roleKey, s.access]))
  );
  const [busy, setBusy] = useState(false);

  // 共有先に選べる運営ロール（管理者・作成者ロールは固定表示なので除外）
  const selectableRoles = useMemo(
    () => allRoles().filter((r) => isStaffRole(r.key) && r.key !== ADMIN_ROLE && r.key !== ownerRole),
    [ownerRole]
  );

  const toggleRole = (key: string) => {
    setShareMap((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, "view");
      return next;
    });
  };
  const setAccess = (key: string, access: FolderAccess) => {
    setShareMap((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.set(key, access);
      return next;
    });
  };

  const save = async () => {
    const shares: FolderShare[] = Array.from(shareMap.entries()).map(([roleKey, access]) => ({ roleKey, access }));
    setBusy(true);

    // 対象フォルダID。作成モード（folder なし）ならまず作成してIDを得る。
    let folderId: number;
    if (!folder) {
      if (!scope) { setBusy(false); toast.error("対象が不明です"); return; }
      const created = await createFolder(scope, name, myRole ?? null);
      if (!created.ok) { setBusy(false); toast.error(created.message); return; }
      folderId = created.value.id;
    } else {
      folderId = folder.id;
    }

    // 公開範囲・共有を保存（作成時の初期 private を選択値で上書き）
    const res = await saveFolderSharing(folderId, visibility, shares);
    setBusy(false);
    if (!res.ok) { toast.error(res.message || "共有の保存に失敗しました"); return; }
    toast.success(isCreate ? "フォルダを作成しました" : "共有設定を保存しました");
    onSaved();
    onClose();
  };

  const MODES: { key: FolderVisibility; label: string; desc: string; icon: "lock" | "users" | "globe" }[] = [
    { key: "private", label: "非公開",        desc: "作成者ロールのみ", icon: "lock" },
    { key: "role",    label: "ロールを指定",   desc: "選んだロールに共有", icon: "users" },
    { key: "public",  label: "全運営に公開",   desc: "全ロールが閲覧可",   icon: "globe" },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 font-bold text-gray-800">
            <Icon name="folder" size={18} className="text-yellow-500" />
            {folder ? `「${folder.name}」を共有` : "フォルダを作成"}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Icon name="close" size={18} /></button>
        </div>

        {/* body */}
        <div className="px-5 py-4 space-y-4">
          {/* フォルダ名（作成モードのみ） */}
          {isCreate && (
            <div>
              <div className="text-[11px] font-bold text-gray-400 mb-1.5">フォルダ名</div>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
                placeholder="例）2026 キャンペーン"
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-red-400" />
            </div>
          )}

          {/* 公開範囲 */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 mb-1.5">公開範囲</div>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button key={m.key} onClick={() => setVisibility(m.key)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center ${
                    visibility === m.key ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                  <Icon name={m.icon} size={18} />
                  <span className="text-[12px] font-bold">{m.label}</span>
                  <span className="text-[10px] leading-tight text-gray-400">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* オーナー行（固定） */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 mb-1.5">アクセスできるロール</div>
            <div className="flex items-center gap-3 py-2 border-b border-gray-50">
              <span className="w-7 h-7 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">管</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800">{ADMIN_ROLE}</div>
                <div className="text-[10.5px] text-gray-400">システム標準ロール</div>
              </div>
              <span className="text-[11.5px] text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1 bg-gray-50">オーナー</span>
            </div>
            {ownerRole && ownerRole !== ADMIN_ROLE && (
              <div className="flex items-center gap-3 py-2 border-b border-gray-50">
                <span className="w-7 h-7 rounded-full bg-indigo-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {(roleLabel(ownerRole) || "?").slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800">{roleLabel(ownerRole)}</div>
                  <div className="text-[10.5px] text-gray-400">作成者ロール・デフォルト共有</div>
                </div>
                <span className="text-[11.5px] text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1 bg-gray-50">オーナー</span>
              </div>
            )}

            {/* 追加共有ロール（visibility=role のときだけ編集可能） */}
            {visibility === "role" ? (
              selectableRoles.length === 0 ? (
                <p className="text-[12px] text-gray-400 py-3">共有できる追加ロールがありません。</p>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {selectableRoles.map((r) => {
                    const on = shareMap.has(r.key);
                    return (
                      <div key={r.key} className="flex items-center gap-3 py-2 border-b border-gray-50">
                        <input type="checkbox" checked={on} onChange={() => toggleRole(r.key)}
                          className="w-4 h-4 accent-red-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-800">{r.label}</div>
                        </div>
                        <select value={shareMap.get(r.key) ?? "view"} disabled={!on}
                          onChange={(e) => setAccess(r.key, e.target.value === "edit" ? "edit" : "view")}
                          className="text-[11.5px] border border-gray-200 rounded-lg px-2 py-1 bg-white disabled:opacity-40">
                          <option value="view">閲覧のみ</option>
                          <option value="edit">編集可</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <p className="text-[12px] text-gray-400 py-3">
                {visibility === "public"
                  ? "全ての運営ロールがこのフォルダを閲覧できます。"
                  : "作成者ロールと管理者のみがこのフォルダを閲覧できます。"}
              </p>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={save} disabled={busy || (isCreate && !name.trim())}
            className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
            {busy ? "保存中..." : isCreate ? "作成" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
