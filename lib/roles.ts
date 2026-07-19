// ============================================================
// ロールマスタ（roles）
//
//   ロールは「システム固定ロール」と「派生ロール」の2種類。
//     システム固定 … 管理者 / オペレーター / メンバー / 外部（編集・削除不可）
//     派生         … オペレーターから派生。管理画面から自由に追加できる
//
//   ★派生ロールのデータ参照範囲は派生元（オペレーター）と同一。
//     機能の表示 / 利用可否だけを role_permissions で個別に絞る。
//
//   ⚠️ モジュールレベルのキャッシュを持つ。アプリ起動時に loadRoles() を
//      呼ぶこと（app.tsx の初期ロードで loadRolePermissions() と並べる）。
//      同期関数として使えるようにするためで、これにより isStaffRole() を
//      呼び出し側にマスタを引き回さずに使える。
// ============================================================
import { supabase } from "./supabase";
import { registerOpsRoles, isOpsRole } from "./zone";

/** 派生元にできる唯一のロール（DB 側の derived_must_be_operator と対）*/
export const BASE_ROLE = "オペレーター";

/** システム固定ロール（roles.is_system = true）。順序は表示順 */
export const SYSTEM_ROLES = ["管理者", "オペレーター", "メンバー", "外部"] as const;
export type SystemRoleName = (typeof SYSTEM_ROLES)[number];

/** 運営側のシステム固定ロール */
const SYSTEM_STAFF_ROLES: readonly string[] = ["管理者", BASE_ROLE];

export interface RoleDef {
  key: string;
  label: string;
  isSystem: boolean;
  baseRole: string | null;
  sortOrder: number;
}

/** マスタ未ロード時のフォールバック（システム固定4ロール）*/
const FALLBACK: RoleDef[] = SYSTEM_ROLES.map((key, i) => ({
  key, label: key, isSystem: true, baseRole: null, sortOrder: (i + 1) * 10,
}));

let _roles: RoleDef[] = [...FALLBACK];
let _loaded = false;

const fromRow = (r: {
  key: string; label: string; is_system: boolean;
  base_role: string | null; sort_order: number;
}): RoleDef => ({
  key: r.key,
  label: r.label,
  isSystem: r.is_system,
  baseRole: r.base_role,
  sortOrder: r.sort_order,
});

// ── 読み取り ────────────────────────────────────────────────

/** ロールマスタを読み込みキャッシュする。失敗時はフォールバックを維持 */
export async function loadRoles(): Promise<RoleDef[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("key, label, is_system, base_role, sort_order")
    .order("sort_order", { ascending: true });

  if (error || !data || data.length === 0) {
    // roles テーブル未作成（マイグレーション未適用）でもアプリを止めない
    _roles = [...FALLBACK];
    _loaded = false;
    registerOpsRoles([]);
    return _roles;
  }
  _roles = data.map(fromRow);
  _loaded = true;
  // ゾーン判定（lib/zone.ts の isOpsRole）へ派生ロールを反映する
  registerOpsRoles(_roles.filter((r) => r.baseRole === BASE_ROLE).map((r) => r.key));
  return _roles;
}

/** キャッシュ済みの全ロール（表示順）*/
export const allRoles = (): RoleDef[] => _roles;

/** 全ロールのキー配列（権限表の列など）*/
export const allRoleKeys = (): string[] => _roles.map((r) => r.key);

/** マスタがDBから読めているか（未適用環境の判定用）*/
export const rolesLoaded = (): boolean => _loaded;

export const findRole = (key: string | null | undefined): RoleDef | null =>
  key ? _roles.find((r) => r.key === key) ?? null : null;

/** 表示名（未登録キーはそのまま返す）*/
export const roleLabel = (key: string | null | undefined): string =>
  findRole(key)?.label ?? key ?? "";

/** システム固定ロールか（編集・削除の可否）*/
export const isSystemRole = (key: string | null | undefined): boolean =>
  (SYSTEM_ROLES as readonly string[]).includes(key ?? "") || findRole(key)?.isSystem === true;

/** 派生ロールか */
export const isDerivedRole = (key: string | null | undefined): boolean => {
  const r = findRole(key);
  return !!r && !r.isSystem && r.baseRole === BASE_ROLE;
};

// ── 判定 ────────────────────────────────────────────────────

/**
 * 運営側ロールか（管理者・オペレーター・その派生）。
 *
 * ⚠️ 従来コードに散在していた
 *      `m.role !== "管理者" && m.role !== "オペレーター"`
 *    という否定形の判定を、必ずこの関数に集約すること。
 *    直接比較のまま放置すると、派生ロールが「会員」に誤分類され、
 *    一斉配信の宛先やAIコンテキストに運営スタッフが混入する。
 */
export function isStaffRole(
  role: string | null | undefined,
  /**
   * 運営ロールキーの集合。サーバー側（配信エンジン等）では
   * モジュールキャッシュが空なので、lib/rolesServer.ts の
   * loadStaffRoleKeys() で取得したものを明示的に渡すこと。
   */
  staffKeys?: ReadonlySet<string>,
): boolean {
  if (!role) return false;
  if (staffKeys) return staffKeys.has(role);
  if (SYSTEM_STAFF_ROLES.includes(role)) return true;
  return findRole(role)?.baseRole === BASE_ROLE;
}

/** 会員側ロールか（isStaffRole の否定。可読性のため用意）*/
export const isMemberSideRole = (role: string | null | undefined): boolean =>
  !!role && !isStaffRole(role);

/**
 * 実効ロール：派生ロールを派生元（システム固定ロール）へ解決する。
 * usePermission の enum 変換や、ロール別の分岐で使う。
 */
export function effectiveRole(role: string | null | undefined): string {
  if (!role) return "メンバー";
  const r = findRole(role);
  return r && !r.isSystem && r.baseRole ? r.baseRole : role;
}

/**
 * DB の is_ops() を直接引いて「運営か」を判定する。
 *
 * ログイン直後（ロールマスタのキャッシュがまだ空）や middleware 相当の
 * 経路で使う。派生ロールは roles.base_role を見る SQL 側で解決されるため、
 * ロールを追加してもこの呼び出し側を変更する必要がない。
 *
 * @param fallbackRole RPC が失敗した場合に静的リストで判定するロール名
 */
export async function fetchIsOps(fallbackRole?: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_ops");
  if (error) return isOpsRole(fallbackRole);   // is_ops() 未適用環境へのフォールバック
  return data === true;
}

// ── 表示 ────────────────────────────────────────────────────

/**
 * ロールバッジの配色（Tailwind クラス）。
 *
 * ⚠️ 従来は各画面で `role === "管理者" ? ... : ...` と三項演算子を並べており、
 *    派生ロールが「その他」＝メンバー色（緑）になってしまっていた。
 *    配色はこの関数に集約すること。
 */
export function roleBadgeClass(role: string | null | undefined): string {
  if (role === "管理者")   return "bg-red-50 text-red-600 border-red-200";
  if (role === BASE_ROLE)  return "bg-blue-50 text-blue-600 border-blue-200";
  if (role === "外部")     return "bg-gray-50 text-gray-500 border-gray-200";
  if (isDerivedRole(role)) return "bg-violet-50 text-violet-600 border-violet-200";
  return "bg-green-50 text-green-600 border-green-200";   // メンバー、および未知のロール
}

// ── 書き込み（管理者のみ。RLS とトリガーでサーバー側も保護）──────

export interface NewRoleInput {
  key: string;
  label?: string;
  sortOrder?: number;
}

/** 派生ロールを作成する。base_role は常に「オペレーター」 */
export async function createDerivedRole(input: NewRoleInput): Promise<RoleDef | null> {
  const key = input.key.trim();
  if (!key) return null;

  const { data, error } = await supabase
    .from("roles")
    .insert({
      key,
      label: (input.label ?? key).trim() || key,
      is_system: false,
      base_role: BASE_ROLE,
      sort_order: input.sortOrder ?? 100,
    })
    .select("key, label, is_system, base_role, sort_order")
    .single();

  if (error || !data) return null;
  const role = fromRow(data);
  _roles = [..._roles, role].sort((a, b) => a.sortOrder - b.sortOrder);
  return role;
}

/** 表示名・並び順の更新（key と base_role は変更不可）*/
export async function updateRole(
  key: string,
  patch: { label?: string; sortOrder?: number }
): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.label != null) row.label = patch.label.trim();
  if (patch.sortOrder != null) row.sort_order = patch.sortOrder;
  if (Object.keys(row).length === 0) return true;

  const { error } = await supabase.from("roles").update(row).eq("key", key);
  if (error) return false;

  _roles = _roles
    .map((r) => (r.key === key
      ? { ...r, label: (patch.label ?? r.label), sortOrder: patch.sortOrder ?? r.sortOrder }
      : r))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return true;
}

/** 派生ロールを削除する（使用中なら DB 側の RESTRICT で失敗する）*/
export async function deleteRole(key: string): Promise<boolean> {
  if (isSystemRole(key)) return false;
  const { error } = await supabase.from("roles").delete().eq("key", key);
  if (error) return false;
  _roles = _roles.filter((r) => r.key !== key);
  return true;
}

/**
 * 権限マスタを src → dst へ複製する（ロール作成直後の初期化）。
 * コピーしない場合、canFor() が全て false に倒れ「何も見えないロール」になる。
 */
export async function copyRolePermissions(srcRole: string, dstRole: string): Promise<boolean> {
  const { error } = await supabase.rpc("copy_role_permissions", {
    src_role: srcRole,
    dst_role: dstRole,
  });
  return !error;
}

/** ロール別の使用中メンバー数（削除ガードの表示用）*/
export async function countMembersByRole(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("members")
    .select("role")
    .eq("is_deleted", false);

  if (error || !data) return {};
  const out: Record<string, number> = {};
  for (const r of data as { role: string | null }[]) {
    if (r.role) out[r.role] = (out[r.role] ?? 0) + 1;
  }
  return out;
}
