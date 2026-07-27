"use client";
// 接続中のLINEアカウントを取得し、参照中アカウントの選択状態を持つ共通フック。
//   LINE関連の各画面（トーク・友だち一覧・名寄せ）のヘッダー帯で共用する。
import { useEffect, useState } from "react";
import type { LineAccount } from "../lib/models";
import { fetchLineAccounts } from "../lib/lineAccounts";

export function useLineAccounts(): {
  accounts: LineAccount[];
  accountId: number | null;
  setAccountId: (id: number) => void;
} {
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    fetchLineAccounts().then((a) => {
      setAccounts(a);
      setAccountId((prev) => prev ?? (a.length > 0 ? a[0].id : null));
    });
  }, []);

  return { accounts, accountId, setAccountId };
}
