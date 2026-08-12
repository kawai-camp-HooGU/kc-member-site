"use client";
// LINEトーク（運営）：友だち一覧＋会話（2カラム）。Realtimeで新着即時反映。
//   ・受信保存・送信はサーバー（/api/line/*）。ここは表示と操作のみ。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { useMaster } from "../hooks/useMaster";
import { useAccountAccess } from "../hooks/useAccountAccess";
import { supabase } from "../lib/supabase";
import type { LineAccount, LineFriend, LineMessage } from "../lib/models";
import {
  fetchLineFriends, fetchLineMessages, fetchLineUnreadMap,
  markLineFriendRead, sendLineMessage, sendLineMedia, unlinkLineFriend,
} from "../lib/line";
import { fetchLineAccounts } from "../lib/lineAccounts";
import { createLineBookmark, deleteBookmarkByLineMessage, fetchBookmarkedLineMessageIds } from "../lib/bookmarks";
import { FriendList } from "../components/line/FriendList";
import { LineConversation } from "../components/line/LineConversation";
import { LineAccountBar } from "../components/line/LineAccountBar";
import { LineAiPanel } from "../components/line/LineAiPanel";
import { BookmarkModal } from "../components/chat/BookmarkModal";

export function LineChatView() {
  const { members, can } = useMaster();
  const acc = useAccountAccess();
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [friends, setFriends] = useState<LineFriend[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<number, number>>({});
  const [messages, setMessages] = useState<LineMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  // ブックマーク
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());
  const [bmTarget, setBmTarget] = useState<LineMessage | null>(null);
  const [bmBusy, setBmBusy] = useState(false);

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
  // アカウント単位権限：閲覧不可のアカウントはピッカーから隠す（読込前は全表示でロックアウト回避）
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !acc.loaded || acc.canSee("line_chat", "line", a.id)),
    [accounts, acc]
  );
  const selectedFriend = friends.find((f) => f.id === selectedId) ?? null;

  // アカウントを切り替えたら、そのアカウントの先頭の友だちを開く
  useEffect(() => {
    if (accountId == null) return;
    if (selectedFriend && selectedFriend.accountId === accountId) return;
    // 3ペインが並ぶ広い画面(xl=1280px以上)だけ先頭友だちを自動で開く。
    //   スマホ/タブレットはマスター詳細なので、自動選択せず一覧を見せる。
    const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
    setSelectedId(wide && shownFriends.length > 0 ? shownFriends[0].id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, shownFriends]);

  const loadFriends = useCallback(async () => {
    const list = await fetchLineFriends();
    setFriends(list);
    setUnreadMap(await fetchLineUnreadMap(list));
    const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
    if (selectedRef.current == null && list.length > 0 && wide) setSelectedId(list[0].id);
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
    if (accountId != null && !acc.canOperate("line_chat", "line", accountId)) {
      alert("このアカウントは閲覧のみ（送信権限がありません）"); return;
    }
    setSending(true);
    const r = await sendLineMessage(selectedId, text);
    setSending(false);
    if (!r.ok) { alert(r.error ?? "送信に失敗しました"); return; }
    await loadMessages(selectedId);
    await loadFriends();
  };

  const handleSendMedia = async (file: File) => {
    if (selectedId == null) return;
    if (accountId != null && !acc.canOperate("line_chat", "line", accountId)) {
      alert("このアカウントは閲覧のみ（送信権限がありません）"); return;
    }
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

  // ── ブックマーク（Phase 3）──
  const loadBookmarks = useCallback(async () => {
    setBookmarkedIds(await fetchBookmarkedLineMessageIds());
  }, []);
  useEffect(() => { loadBookmarks(); }, [loadBookmarks]);

  const saveBookmark = async (genre: string) => {
    if (!bmTarget) return;
    setBmBusy(true);
    await createLineBookmark({
      sourceLineMessageId: bmTarget.id,
      sourceMemberId: selectedFriend?.memberId ?? null,
      sourceMessageAt: bmTarget.createdAt || null,
      originalText: bmTarget.body,
      genre,
    });
    setBmBusy(false); setBmTarget(null);
    await loadBookmarks();
  };
  const removeBookmark = async () => {
    if (!bmTarget) return;
    setBmBusy(true);
    await deleteBookmarkByLineMessage(bmTarget.id);
    setBmBusy(false); setBmTarget(null);
    await loadBookmarks();
  };

  // ── 会員連携（表示・解除。手動の名寄せは「名寄せ」画面に集約）──
  const selectedMember = selectedFriend?.memberId != null
    ? (members.find((m) => m.id === selectedFriend.memberId) ?? null)
    : null;
  const memberName = selectedMember?.name ?? "";
  const handleUnlink = async () => {
    if (selectedId == null) return { ok: false, error: "未選択" };
    const r = await unlinkLineFriend(selectedId);
    await loadFriends();
    return r;
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-120px)] min-h-[520px] rounded-xl overflow-hidden border border-gray-200 bg-white -mx-2 relative">
      <LineAccountBar
        screenLabel="LINEトーク"
        accounts={visibleAccounts}
        accountId={accountId}
        onSelectAccount={setAccountId}
        right={can("ai") ? (
          <button
            onClick={() => setAiOpen(true)}
            className="xl:hidden text-[12px] font-bold text-white bg-white/20 border border-white/30 rounded-lg px-3 py-1"
          >
            ✦ AIアシスタント
          </button>
        ) : undefined}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-[280px] flex-shrink-0 h-full">
          <FriendList
            friends={shownFriends}
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
          onSendMedia={handleSendMedia}
          onMarkRead={handleMarkRead}
          memberName={memberName}
          member={selectedMember}
          onUnlink={handleUnlink}
          text={composer}
          onTextChange={setComposer}
          bookmarkedIds={bookmarkedIds}
          onBookmark={(m) => setBmTarget(m)}
        />
        {/* AIパネル：xl以上は右に常時表示、xl未満はドロワー（ポータルトークと同仕様） */}
        {can("ai") && (
          <>
            {aiOpen && <div className="xl:hidden fixed inset-0 bg-black/40 z-[59]" onClick={() => setAiOpen(false)} />}
            <div className={`${aiOpen ? "flex" : "hidden"} xl:flex fixed xl:static top-0 right-0 h-full z-[60] xl:z-auto shadow-2xl xl:shadow-none`}>
              <div className="xl:hidden absolute -left-9 top-2">
                <button onClick={() => setAiOpen(false)} className="w-8 h-8 rounded-full bg-white shadow border border-gray-200 text-gray-500">×</button>
              </div>
              <div className="w-[340px] h-full">
                <LineAiPanel friendId={selectedId} onAdopt={(t) => setComposer(t)} />
              </div>
            </div>
          </>
        )}
      </div>

      {bmTarget && (
        <BookmarkModal
          originalText={bmTarget.body}
          alreadyBookmarked={bookmarkedIds.has(bmTarget.id)}
          busy={bmBusy}
          onSave={saveBookmark}
          onDelete={removeBookmark}
          onClose={() => setBmTarget(null)}
        />
      )}
    </div>
  );
}
