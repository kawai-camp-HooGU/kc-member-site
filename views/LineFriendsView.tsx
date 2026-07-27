"use client";
// LINE友だち一覧（テーブル）。会員連携状況・状態・最終トークを一覧。
//   ⚠️ 友だち総数はLINE APIで一括取得できないため、ここに出るのは
//      「連携開始後に観測できた友だち」のみ。正確な総数はLINE公式管理画面を併用。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import type { LineFriend } from "../lib/models";
import { fetchLineFriends, fetchLineUnreadMap } from "../lib/line";
import { fmtTime, statusStyle } from "../components/line/lineUtils";
import { FriendAvatar } from "../components/line/FriendAvatar";

type Tab = "active" | "unlinked" | "blocked";

export function LineFriendsView() {
  const route = useRoute();
  const [friends, setFriends] = useState<LineFriend[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<number, number>>({});
  const [tab, setTab] = useState<Tab>("active");

  const load = useCallback(async () => {
    const list = await fetchLineFriends();
    setFriends(list);
    setUnreadMap(await fetchLineUnreadMap(list));
  }, []);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = friends.filter((f) => f.status === "friend");
    return {
      active: active.length,
      linked: active.filter((f) => f.memberId != null).length,
      unlinked: active.filter((f) => f.memberId == null).length,
      blocked: friends.filter((f) => f.status !== "friend").length,
    };
  }, [friends]);

  const shown = useMemo(() => {
    if (tab === "blocked") return friends.filter((f) => f.status !== "friend");
    const active = friends.filter((f) => f.status === "friend");
    if (tab === "unlinked") return active.filter((f) => f.memberId == null);
    return active;
  }, [friends, tab]);

  const openTalk = (friendId: number) => route.go("line", [friendId]);

  return (
    <div className="h-full overflow-auto p-5">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-extrabold">友だち一覧</h1>
        <span className="text-xs text-gray-500">
          LINE公式アカウントの友だちと会員の連携状況（観測できた友だちのみ表示）
        </span>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        {([
          ["友だち（有効）", stats.active],
          ["会員連携済", stats.linked],
          ["未連携", stats.unlinked],
          ["ブロック", stats.blocked],
        ] as const).map(([k, v]) => (
          <div key={k} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 min-w-[120px]">
            <div className="text-[10.5px] text-gray-500">{k}</div>
            <div className="text-xl font-extrabold">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 mb-3">
        {([["active", "有効な友だち"], ["unlinked", "未連携のみ"], ["blocked", "ブロック"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-[11px] font-bold border rounded-full px-3 py-1 ${
              tab === k ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <table className="w-full border-collapse bg-white border border-gray-200 rounded-xl overflow-hidden text-[13px]">
        <thead>
          <tr>
            {["LINE表示名", "会員", "状態", "友だち追加", "最終トーク", ""].map((h) => (
              <th key={h} className="bg-gray-50 text-[10.5px] text-gray-500 font-bold text-left px-3 py-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-xs">該当する友だちはいません</td></tr>
          )}
          {shown.map((f) => {
            const name = f.displayName || "(名称未取得)";
            const st = statusStyle(f.status);
            const unread = unreadMap[f.id] ?? 0;
            return (
              <tr key={f.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <FriendAvatar name={name} pictureUrl={f.pictureUrl} seed={f.lineUserId} size={28} />
                    {name}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {f.memberId != null
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">#{f.memberId}</span>
                    : <span className="text-gray-400">―</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                </td>
                <td className="px-3 py-2.5 text-gray-600">{fmtTime(f.followedAt)}</td>
                <td className="px-3 py-2.5 text-gray-600">
                  {fmtTime(f.lastMessageAt)}
                  {unread > 0 && <span className="ml-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">未読{unread}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => openTalk(f.id)}
                    disabled={f.status !== "friend"}
                    className="text-[11.5px] font-bold border border-gray-200 rounded-md px-2.5 py-1 disabled:opacity-40"
                  >
                    {f.status === "friend" ? "トーク" : "送信不可"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
