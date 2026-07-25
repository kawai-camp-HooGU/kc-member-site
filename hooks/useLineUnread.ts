"use client";
// サイドバー「LINEトーク」の未読（顧客発・未確認）総数を提供するフック。
// 初回取得＋line_messages / line_friends の変化（realtime）で再集計する。
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchLineUnreadTotal } from "../lib/line";

export function useLineUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) { setCount(0); return; }
    fetchLineUnreadTotal()
      .then(setCount)
      .catch((e) => console.warn("LINE未読数の取得に失敗:", e));
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("realtime-line-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "line_messages" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "line_friends" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, refresh]);

  return count;
}
