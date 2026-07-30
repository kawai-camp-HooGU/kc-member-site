// ============================================================
// アカウント単位権限 データアクセス（LINE/メール × ロール）── Phase 2
//
//   role_permissions（ロール×機能）の「第2層」。account_role_access を読み書きし、
//   LINE/メールのアカウントごとにロールの可否を定義する。
//
//   ・アクセス系（line_chat / mailbox 等・notif=false）: 'none' | 'view' | 'operate'
//   ・通知系（ntf_talk_push_line 等・notif=true）      : 'on' | 'off'
//
//   管理者は常に最上位（operate / on）で扱う（RLS でも is_admin() を保証）。
//   行が無い組み合わせは defaultAccess() のフォールバックで解決する。
//
//   ⚠️ enforcement（fetchLineAccounts / fetchAccounts の絞り込み、返信可否）は
//      canSeeAccount / canOperateAccount を使って Phase 2b で配線する。
// ============================================================
import { supabase } from "./supabase";

export type AccountType = "line" | "mail";
export type AccountAccess = "none" | "view" | "operate" | "on" | "off";

export interface AccountAccessRow {
  feature: string;
  accountType: AccountType;
  accountId: number;
  roleKey: string;
  access: AccountAccess;
}

/** `${feature}::${accountType}::${accountId}::${roleKey}` → access のマップ */
export type AccountAccessMap = Record<string, AccountAccess>;
export const accKey = (
  feature: string, type: AccountType, accountId: number, roleKey: string,
): string => `${feature}::${type}::${accountId}::${roleKey}`;

const ACCESS_VALUES: readonly AccountAccess[] = ["none", "view", "operate", "on", "off"];
const toAccess = (v: string | null | undefined): AccountAccess =>
  (ACCESS_VALUES as readonly string[]).includes(v ?? "") ? (v as AccountAccess) : "none";

// ── 読み取り ──────────────────────────────────────────────
/** 全アカウント権限を読み込みマップ化（RLS で見えるものだけ）。未適用環境では空。 */
export async function loadAccountAccess(): Promise<AccountAccessMap> {
  const { data, error } = await supabase
    .from("account_role_access")
    .select("feature, account_type, account_id, role_key, access");
  if (error || !data) return {};
  const m: AccountAccessMap = {};
  for (const r of data as {
    feature: string; account_type: string; account_id: number; role_key: string; access: string;
  }[]) {
    m[accKey(r.feature, r.account_type as AccountType, r.account_id, r.role_key)] = toAccess(r.access);
  }
  return m;
}

// ── 書き込み ──────────────────────────────────────────────
/** まとめて保存（upsert）。権限画面のバッチ保存から呼ぶ。 */
export async function saveAccountAccess(rows: AccountAccessRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    feature: r.feature,
    account_type: r.accountType,
    account_id: r.accountId,
    role_key: r.roleKey,
    access: r.access,
    updated_at: new Date().toISOString(),
  }));
  await supabase
    .from("account_role_access")
    .upsert(payload, { onConflict: "feature,account_type,account_id,role_key" });
}

// ── 既定値・判定 ──────────────────────────────────────────
/**
 * 行が無いときのフォールバック既定値。
 *   ⚠️ 「デフォルト全許可・明示的制限のみ」。行が無ければ現状どおり全アクセス。
 *      管理者・機能ONのロール … operate / on（＝現行挙動を維持。誤ってスタッフの
 *      送信権限を奪わないため view ではなく operate を既定にする）
 *      機能OFFのロール        … none / off
 */
export function defaultAccess(notif: boolean, featureEnabled: boolean, isAdmin: boolean): AccountAccess {
  if (isAdmin) return notif ? "on" : "operate";
  if (!featureEnabled) return notif ? "off" : "none";
  return notif ? "on" : "operate";
}

/** 現在値（下書き優先 → 保存値 → 既定値）を解決する。 */
export function resolveAccess(
  map: AccountAccessMap | null | undefined,
  feature: string, type: AccountType, accountId: number, roleKey: string,
  fallback: AccountAccess,
): AccountAccess {
  const k = accKey(feature, type, accountId, roleKey);
  return (map && k in map) ? map[k] : fallback;
}

/** クリックで次の状態へ（アクセス系: 操作→閲覧→非表示 / 通知系: 通知→停止）。 */
export function nextAccess(a: AccountAccess, notif: boolean): AccountAccess {
  if (notif) return a === "on" ? "off" : "on";
  return a === "operate" ? "view" : a === "view" ? "none" : "operate";
}

/** enforcement 用: そのロールがこのアカウントを閲覧できるか。 */
export function canSeeAccount(access: AccountAccess): boolean {
  return access !== "none" && access !== "off";
}
/** enforcement 用: そのロールがこのアカウントを操作（返信・送信）できるか。 */
export function canOperateAccount(access: AccountAccess): boolean {
  return access === "operate" || access === "on";
}
