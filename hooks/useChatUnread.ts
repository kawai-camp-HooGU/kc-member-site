"use client";
// サイドバー「Chat」の未確認メッセージ総数を提供するフック。
// 初回取得＋chat_messages / chat_conversations の変化（realtime）で再集計する。
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchUnreadTotal } from "../lib/chat";

export function useChatUnread(
  enabled: boolean,
  isStaff: boolean,
  myMemberId: number | null,
): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) { setCount(0); return; }
    fetchUnreadTotal(isStaff, myMemberId)
      .then(setCount)
      .catch((e) => console.warn("未読数の取得に失敗:", e));
  }, [enabled, isStaff, myMemberId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("realtime-chat-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, refresh]);

  return count;
}
