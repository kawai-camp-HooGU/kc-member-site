"use client";
// ============================================================
// useAccountAccess ── アカウント単位権限の UI 側判定（Phase 2b）
//
//   ログインユーザーのロールと account_role_access を突き合わせ、
//   「このアカウントを見られるか / 操作できるか」を返す。
//   LINE/メールの各ビューでアカウント一覧の絞り込み・送信ボタンの抑止に使う。
//
//   ⚠️ これは UX 層の出し分け。実セキュリティ境界は RLS
//      （migration_add_account_access_rls.sql）と /api 側の判定。
// ============================================================
import { useEffect, useState } from "react";
import { useMaster } from "./useMaster";
import {
  loadAccountAccess, resolveAccess, defaultAccess, canSeeAccount, canOperateAccount,
} from "../lib/accountAccess";
import type { AccountAccessMap, AccountType, AccountAccess } from "../lib/accountAccess";
import { permKey, isAdminRole } from "../lib/permissions";

export interface UseAccountAccess {
  loaded: boolean;
  role: string;
  /** 明示値 → 保存値 → 既定値 で解決したアクセス値 */
  access: (feature: string, type: AccountType, accountId: number, notif?: boolean) => AccountAccess;
  /** そのアカウントを閲覧できるか（一覧の絞り込みに使う） */
  canSee: (feature: string, type: AccountType, accountId: number) => boolean;
  /** そのアカウントを操作（返信・送信）できるか */
  canOperate: (feature: string, type: AccountType, accountId: number) => boolean;
}

export function useAccountAccess(): UseAccountAccess {
  const { permission, perms } = useMaster();
  const role = permission.roleLabel;
  const [map, setMap] = useState<AccountAccessMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAccountAccess()
      .then((m) => { if (alive) { setMap(m); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const featEnabled = (feature: string): boolean => !!perms[permKey(role, feature)];

  const access = (feature: string, type: AccountType, accountId: number, notif = false): AccountAccess =>
    resolveAccess(map, feature, type, accountId, role,
      defaultAccess(notif, featEnabled(feature), isAdminRole(role)));

  const canSee = (feature: string, type: AccountType, accountId: number): boolean =>
    canSeeAccount(access(feature, type, accountId, false));

  const canOperate = (feature: string, type: AccountType, accountId: number): boolean =>
    canOperateAccount(access(feature, type, accountId, false));

  return { loaded, role, access, canSee, canOperate };
}
