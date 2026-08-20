// ============================================================
// フォルダ管理 データアクセス＆共通ヘルパー（全画面共通）
//
//   一斉配信・シナリオ・フォーム・テンプレート・属性・お知らせ・
//   流入経路・コンテンツ・ブックマークの各一覧で共有して使う。
//   DBは単一の folders テーブルを scope 列で分ける（1実装で全画面を賄う）。
//
//   ・共有はロール単位（folder_role_shares）。作成者ロールはデフォルト共有＝
//     オーナー相当。管理者は全フォルダを閲覧・管理（RLS で保証）。
//   ・フォルダの見え方は RLS（folders_select）で絞られるため、fetchFolders は
//     「見てよいフォルダ」だけを返す。編集可否はロールで別途判定する。
//
//   ⚠️ クライアント安全な処理のみを置く（service_role には触れない）。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";

// ── 対象画面（scope）─────────────────────────────────────────
//   10画面目以降はここに1行足すだけ。DB・共通部品の変更は不要。
export const FOLDER_SCOPES = [
  "broadcast", "scenario", "form", "template", "attribute",
  "news", "source", "content", "bookmark", "contact_list",
] as const;
export type FolderScope = (typeof FOLDER_SCOPES)[number];

/** フォルダの公開範囲 */
export type FolderVisibility = "private" | "role" | "public";
/** ロールに与えるアクセスレベル */
export type FolderAccess = "edit" | "view";

// ── 型 ────────────────────────────────────────────────────────
export interface FolderShare {
  roleKey: string;
  access: FolderAccess;
}

export interface Folder {
  id: number;
  scope: FolderScope;
  name: string;
  parentId: number | null;
  visibility: FolderVisibility;
  /** 作成者ロール（デフォルト共有・オーナー相当） */
  ownerRole: string;
  sortOrder: number;
  /** ロール単位の追加共有（作成者ロールは含めない。owner はオーナー扱い） */
  shares: FolderShare[];
}

// ── 変換 ──────────────────────────────────────────────────────
function toVisibility(v: string): FolderVisibility {
  return v === "private" || v === "public" ? v : "role";
}
function toAccess(a: string): FolderAccess {
  return a === "edit" ? "edit" : "view";
}
function toFolder(r: Tables<"folders">, shares: FolderShare[]): Folder {
  return {
    id: r.id,
    scope: (FOLDER_SCOPES as readonly string[]).includes(r.scope) ? (r.scope as FolderScope) : "broadcast",
    name: r.name ?? "",
    parentId: r.parent_id ?? null,
    visibility: toVisibility(r.visibility),
    ownerRole: r.owner_role ?? "",
    sortOrder: r.sort_order ?? 0,
    shares,
  };
}

// ── 現在ユーザーのロールキー ──────────────────────────────────
//   folders の編集可否をクライアントで判定するために使う。
//   RPC が失敗しても致命的ではないので null を返す（＝閲覧のみ扱い）。
export async function fetchMyRole(): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_role_key");
  if (error || typeof data !== "string") return null;
  return data;
}

// ── 読み取り ──────────────────────────────────────────────────
/** 指定 scope のフォルダ一覧（RLS で見えるものだけ）＋各フォルダの共有を返す */
export async function fetchFolders(scope: FolderScope): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("scope", scope)
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data || data.length === 0) return [];

  const ids = data.map((r) => r.id);
  const { data: shareRows } = await supabase
    .from("folder_role_shares")
    .select("folder_id, role_key, access")
    .in("folder_id", ids);

  const byFolder = new Map<number, FolderShare[]>();
  for (const s of shareRows ?? []) {
    const arr = byFolder.get(s.folder_id) ?? [];
    arr.push({ roleKey: s.role_key, access: toAccess(s.access) });
    byFolder.set(s.folder_id, arr);
  }
  return data.map((r) => toFolder(r, byFolder.get(r.id) ?? []));
}

// ── 権限判定（クライアント側の出し分け。RLS でも二重に守る）──────
/** 管理者ロールか（システム固定の「管理者」）*/
export const isAdminRole = (myRole: string | null): boolean => myRole === "管理者";

/** そのフォルダをこのロールが編集できるか（レコード移動・名前変更・並べ替え）*/
export function canEditFolder(f: Folder, myRole: string | null): boolean {
  if (isAdminRole(myRole)) return true;
  if (myRole && f.ownerRole === myRole) return true;
  return f.shares.some((s) => s.roleKey === myRole && s.access === "edit");
}

/** そのフォルダの共有設定を変更できるか（オーナー＝作成者ロール or 管理者）*/
export function canManageFolder(f: Folder, myRole: string | null): boolean {
  return isAdminRole(myRole) || (!!myRole && f.ownerRole === myRole);
}

// ── 書き込み ──────────────────────────────────────────────────
export type WriteResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * フォルダを作成する。作成者ロールがオーナー＝デフォルト共有になる。
 *   myRole を渡さない（空）場合は current_role_key() を引いて解決する。
 *   RLS の with check（owner_role = current_role_key()）に一致させるため必須。
 */
export async function createFolder(
  scope: FolderScope,
  name: string,
  myRole?: string | null,
  sortOrder = 0,
): Promise<WriteResult<Folder>> {
  const nm = (name ?? "").trim();
  if (!nm) return { ok: false, message: "フォルダ名を入力してください" };
  if (nm.length > 40) return { ok: false, message: "フォルダ名は40文字以内で入力してください" };

  const ownerRole = (myRole && myRole.trim()) ? myRole.trim() : await fetchMyRole();
  if (!ownerRole) return { ok: false, message: "ロールを特定できませんでした。再ログインしてください。" };

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("folders")
    .insert({
      scope,
      name: nm,
      visibility: "private",   // 初期は作成者ロールのみ。共有ダイアログで広げる
      owner_role: ownerRole,
      created_by: user?.id ?? null,
      sort_order: sortOrder,
    })
    .select("*")
    .single();
  if (error) return { ok: false, message: `${error.message}（code: ${error.code ?? "-"}）` };
  if (!data)  return { ok: false, message: "作成結果を取得できませんでした" };
  return { ok: true, value: toFolder(data, []) };
}

/** フォルダ名を変更する */
export async function renameFolder(id: number, name: string): Promise<WriteResult<true>> {
  const nm = (name ?? "").trim();
  if (!nm) return { ok: false, message: "フォルダ名を入力してください" };
  if (nm.length > 40) return { ok: false, message: "フォルダ名は40文字以内で入力してください" };
  const { error } = await supabase
    .from("folders")
    .update({ name: nm, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, message: error.message } : { ok: true, value: true };
}

/**
 * フォルダを論理削除する。中のレコードは folder_id=null＝「すべて（未分類）」へ戻す。
 *   論理削除（is_deleted）のため DB の on delete set null は発火しない。scope ごとに
 *   対象テーブルの folder_id を明示的に外す。画面展開のたびにここへ1分岐足す。
 */
export async function deleteFolder(id: number, scope: FolderScope): Promise<WriteResult<true>> {
  if (scope === "broadcast") await supabase.from("broadcasts").update({ folder_id: null }).eq("folder_id", id);
  else if (scope === "scenario") await supabase.from("scenarios").update({ folder_id: null }).eq("folder_id", id);
  else if (scope === "form") await supabase.from("forms").update({ folder_id: null }).eq("folder_id", id);
  else if (scope === "template") await supabase.from("templates").update({ folder_id: null }).eq("folder_id", id);
  else if (scope === "news") await supabase.from("news").update({ folder_id: null }).eq("folder_id", id);
  else if (scope === "source") await supabase.from("sources").update({ folder_id: null }).eq("folder_id", id);
  // chat_bookmarks は database.types 未登録テーブルのため untyped で更新する
  else if (scope === "bookmark") await (supabase as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: number) => Promise<unknown> } } }).from("chat_bookmarks").update({ folder_id: null }).eq("folder_id", id);
  // 属性（attribute）は階層ツリーで分類するためフォルダ対象外

  const { error } = await supabase
    .from("folders")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, message: error.message } : { ok: true, value: true };
}

/** 並び順をまとめて更新する（ドラッグ入替後）*/
export async function reorderFolders(orderedIds: number[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("folders").update({ sort_order: i }).eq("id", id)
    )
  );
}

// ── 共有（公開範囲）の保存 ────────────────────────────────────
/**
 * フォルダの公開範囲と共有ロールを保存する。
 *   visibility='role' のときだけ shares（作成者ロール以外）を反映する。
 *   既存の共有は一旦全消し→入れ直し（差分計算より単純で事故りにくい）。
 */
export async function saveFolderSharing(
  folderId: number,
  visibility: FolderVisibility,
  shares: FolderShare[],
): Promise<WriteResult<true>> {
  const { error: upErr } = await supabase
    .from("folders")
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq("id", folderId);
  if (upErr) return { ok: false, message: upErr.message };

  const { error: delErr } = await supabase
    .from("folder_role_shares")
    .delete()
    .eq("folder_id", folderId);
  if (delErr) return { ok: false, message: delErr.message };

  const rows = visibility === "role"
    ? shares.map((s) => ({ folder_id: folderId, role_key: s.roleKey, access: s.access }))
    : [];
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("folder_role_shares").insert(rows);
    if (insErr) return { ok: false, message: insErr.message };
  }
  return { ok: true, value: true };
}
