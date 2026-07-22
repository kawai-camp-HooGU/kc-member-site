"use client";
// ============================================================
// リアルタイム同時閲覧数（Supabase Realtime Presence）
//
//   「今このフォームを開いている人数」を、DBを一切使わずに数える。
//   Presence は接続中のクライアントだけが持つ揮発的な状態で、
//   タブを閉じる／離脱すると自動的に消える（＝現在値がそのまま人数になる）。
//
//   使い分け：
//     track=true  … 「今ここにいる」印を送る側（公開フォーム）。表示はしない。
//     track=false … 印は送らず人数だけ観測する側（運営ダッシュボード）。
//
//   ⚠️ 送る側と観測する側で key を必ず一致させること（例：form:{slug}）。
//   ⚠️ 数えるのは「接続中のタブ数」。同じ人が2タブ開くと2としてカウントされる
//      （キーをタブ単位のランダムIDにしているため、実人数の近似値という位置づけ）。
// ============================================================
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export function usePresenceCount(key: string, opts?: { track?: boolean }): number {
  const track = opts?.track ?? false;
  const [count, setCount] = useState(0);

  // タブごとに安定した一意キー。再購読しても同一タブは1つに集約される。
  const idRef = useRef<string>("");
  if (!idRef.current) {
    idRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }

  useEffect(() => {
    if (!key) return;
    const channel = supabase.channel(`presence:${key}`, {
      config: { presence: { key: idRef.current } },
    });

    // presenceState() のキー数＝接続中クライアント数
    const recount = () => setCount(Object.keys(channel.presenceState()).length);

    channel
      .on("presence", { event: "sync" }, recount)
      .on("presence", { event: "join" }, recount)
      .on("presence", { event: "leave" }, recount)
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && track) {
          void channel.track({ at: Date.now() });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [key, track]);

  return count;
}

// ── 複数フォームをまとめて観測（運営ダッシュボード用・track しない）──
//   返り値は key→人数 のマップ。合計は Object.values(map).reduce で出す。
//   一覧の各行が個別に接続するのを避け、1画面ぶんの購読をここへ集約する。
export function usePresenceCounts(keys: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const idRef = useRef<string>("");
  if (!idRef.current) {
    idRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }

  // keys 配列の中身が同じなら再購読しないよう、安定した文字列に畳む
  const keysJoined = [...keys].sort().join("|");

  useEffect(() => {
    if (!keysJoined) { setCounts({}); return; }
    const list = keysJoined.split("|");
    const channels = list.map((key) => {
      const channel = supabase.channel(`presence:${key}`, {
        config: { presence: { key: idRef.current } },
      });
      const recount = () =>
        setCounts((prev) => ({ ...prev, [key]: Object.keys(channel.presenceState()).length }));
      channel
        .on("presence", { event: "sync" }, recount)
        .on("presence", { event: "join" }, recount)
        .on("presence", { event: "leave" }, recount)
        .subscribe();   // 観測のみ（track しない＝人数に加算されない）
      return channel;
    });
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, [keysJoined]);

  return counts;
}
