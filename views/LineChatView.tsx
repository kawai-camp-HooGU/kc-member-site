"use client";
// LINEトーク（運営）：友だち一覧＋会話（2カラム）。Realtimeで新着即時反映。
//   ・受信保存・送信はサーバー（/api/line/*）。ここは表示と操作のみ。
import { useCallback, useEffect, useRef, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { supabase } from "../lib/supabase";
import type { LineFriend, LineMessage } from "../lib/models";
import {
  fetchLineFriends, fetchLineMessages, fetchLineUnreadMap,
  markLineFriendRead, sendLineMessage,
} from "../lib/line";
import { FriendList } from "../components/line/FriendList";
import { LineConversation } from "../components/line/LineConversation";

export function LineChatView() {
  const [friends, setFriends] = useState<LineFriend[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<number, number>>({});
  const [messages, setMessages] = useState<LineMessage[]>([]);
  const [sending, setSending] = useState(false);

  // 開いている友だちは URL に載せる（/ops/line/{friendId}）
  const route = useRoute();
  const selectedId = route.detail[0] ? Number(route.detail[0]) : null;
  const setSelectedId = (id: number | null) => route.goDetail(id == null ? [] : [id]);
  const selectedRef = useRef<number | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  const selectedFriend = friends.find((f) => f.id === selectedId) ?? null;

  const loadFriends = useCallback(async () => {
    const list = await fetchLineFriends();
    setFriends(list);
    setUnreadMap(await fetchLineUnreadMap(list));
    if (selectedRef.current == null && list.length > 0) setSelectedId(list[0].id);
  }, []);

  const loadMessages = useCallback(async (friendId: number) => {
    setMessages(await fetchLineMessages(friendId));
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);
  useEffect(() => { if (selectedId != null) loadMessages(selectedId); }, [selectedId, loadMessages]);

  // Realtime：新着・友だち更新で再取得
  useEffect(() => {
    const ch = supabase.channel("realtime-line-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "line_messages" }, () => {
        loadFriends();
        if (selectedRef.current != null) loadMessages(selectedRef.current);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "line_friends" }, () => loadFriends())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadFriends, loadMessages]);

  const handleSend = async (text: string) => {
    if (selectedId == null) return;
    setSending(true);
    const r = await sendLineMessage(selectedId, text);
    setSending(false);
    if (!r.ok) { alert(r.error ?? "送信に失敗しました"); return; }
    await loadMessages(selectedId);
    await loadFriends();
  };

  const handleMarkRead = async () => {
    if (selectedId == null) return;
    await markLineFriendRead(selectedId);
    await loadFriends();
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="w-[280px] flex-shrink-0 h-full">
        <FriendList
          friends={friends}
          unreadMap={unreadMap}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
        />
      </div>
      <LineConversation
        friend={selectedFriend}
        messages={messages}
        sending={sending}
        onSend={handleSend}
        onMarkRead={handleMarkRead}
      />
    </div>
  );
}
