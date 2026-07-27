"use client";
// LINEトーク（運営）：友だち一覧＋会話（2カラム）。Realtimeで新着即時反映。
//   ・受信保存・送信はサーバー（/api/line/*）。ここは表示と操作のみ。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { supabase } from "../lib/supabase";
import type { LineAccount, LineFriend, LineMessage } from "../lib/models";
import {
  fetchLineFriends, fetchLineMessages, fetchLineUnreadMap,
  markLineFriendRead, sendLineMessage, sendLineMedia,
} from "../lib/line";
import { fetchLineAccounts } from "../lib/lineAccounts";
import { FriendList } from "../components/line/FriendList";
import { LineConversation } from "../components/line/LineConversation";

export function LineChatView() {
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
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

  // 接続アカウントを取得し、既定で先頭を選択
  useEffect(() => {
    fetchLineAccounts().then((a) => {
      setAccounts(a);
      setAccountId((prev) => prev ?? (a.length > 0 ? a[0].id : null));
    });
  }, []);

  // 選択中アカウントの友だちだけ表示（アカウント未選択なら全件）
  const shownFriends = useMemo(
    () => (accountId == null ? friends : friends.filter((f) => f.accountId === accountId)),
    [friends, accountId]
  );
  const selectedFriend = friends.find((f) => f.id === selectedId) ?? null;

  // アカウントを切り替えたら、そのアカウントの先頭の友だちを開く
  useEffect(() => {
    if (accountId == null) return;
    if (selectedFriend && selectedFriend.accountId === accountId) return;
    setSelectedId(shownFriends.length > 0 ? shownFriends[0].id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, shownFriends]);

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

  const handleSendMedia = async (file: File) => {
    if (selectedId == null) return;
    const r = await sendLineMedia(selectedId, file);
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
          friends={shownFriends}
          unreadMap={unreadMap}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          accounts={accounts}
          accountId={accountId}
          onSelectAccount={setAccountId}
        />
      </div>
      <LineConversation
        friend={selectedFriend}
        messages={messages}
        sending={sending}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onMarkRead={handleMarkRead}
      />
    </div>
  );
}
