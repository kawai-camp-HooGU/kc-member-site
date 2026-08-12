"use client";
// ============================================================
// useFolders — 指定 scope のフォルダ一覧・現在ロール・選択状態をまとめて扱う共通フック。
//   一斉配信・シナリオ・フォーム・テンプレート・属性…の各一覧で共用する。
//
//   ・folders   … RLS で「見てよいフォルダ」だけが返る
//   ・myRole    … 編集可否の判定に使う現在ユーザーのロールキー
//   ・selected  … 選択中フォルダ（"all"=すべて / number=フォルダID）
//   ・reload    … 作成・移動・共有変更のあとに呼ぶ
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFolders, fetchMyRole, canEditFolder, canManageFolder,
} from "../lib/folders";
import type { Folder, FolderScope } from "../lib/folders";

/**
 * 画面遷移（一覧→編集→一覧）でリスト側が再マウントされても、
 * 直前に見ていたフォルダを復元するための scope 別キャッシュ（アプリ稼働中のみ保持）。
 * これにより「フォルダ内で編集→戻る」で所属元フォルダに戻れる。
 */
const lastSelectedByScope = new Map<FolderScope, FolderSelection>();

/** 選択中フォルダ。"all"=すべて（横断） */
/** "unfiled"=未分類（folder_id が null のレコード）／ number=フォルダID */
export type FolderSelection = "unfiled" | number;

export interface UseFolders {
  folders: Folder[];
  myRole: string | null;
  loading: boolean;
  selected: FolderSelection;
  setSelected: (s: FolderSelection) => void;
  reload: () => void;
  /** 選択中フォルダの Folder（"unfiled"＝未分類のときは null） */
  selectedFolder: Folder | null;
  /** そのフォルダにレコードを入れられるか（編集可）*/
  canEdit: (folderId: number) => boolean;
  /** そのフォルダの共有設定を変えられるか（オーナー/管理者）*/
  canManage: (folderId: number) => boolean;
}

export function useFolders(scope: FolderScope): UseFolders {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 初期選択は「直前に見ていたフォルダ（キャッシュ）」→ なければ未分類
  const [selected, setSelectedState] = useState<FolderSelection>(
    () => lastSelectedByScope.get(scope) ?? "unfiled"
  );
  // 選択を変えたらキャッシュも更新（次回マウント時に復元される）
  const setSelected = useCallback((s: FolderSelection) => {
    lastSelectedByScope.set(scope, s);
    setSelectedState(s);
  }, [scope]);

  const reload = useCallback(() => {
    setLoading(true);
    void Promise.all([fetchFolders(scope), fetchMyRole()]).then(([fs, role]) => {
      setFolders(fs);
      setMyRole(role);
      setLoading(false);
      // 選択中フォルダが消えていたら「未分類」に戻す（キャッシュも同期）
      setSelectedState((prev) => {
        const next = prev === "unfiled" || fs.some((f) => f.id === prev) ? prev : "unfiled";
        lastSelectedByScope.set(scope, next);
        return next;
      });
    });
  }, [scope]);

  useEffect(() => { reload(); }, [reload]);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const selectedFolder = useMemo<Folder | null>(
    () => (typeof selected === "number" ? byId.get(selected) ?? null : null),
    [selected, byId]
  );

  const canEdit = useCallback(
    (folderId: number) => {
      const f = byId.get(folderId);
      return f ? canEditFolder(f, myRole) : false;
    },
    [byId, myRole]
  );

  const canManage = useCallback(
    (folderId: number) => {
      const f = byId.get(folderId);
      return f ? canManageFolder(f, myRole) : false;
    },
    [byId, myRole]
  );

  return {
    folders, myRole, loading, selected, setSelected, reload,
    selectedFolder, canEdit, canManage,
  };
}
