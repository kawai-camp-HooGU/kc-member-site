"use client";
// ============================================================
// サマリー（コミュニケーション＞対応）
//   ポータルトーク／メール／LINE を横断した「登録者・友だち数」と「トーク未対応数」を
//   実データで集約表示する（lib/summary.ts）。各行クリックで該当チャネルへ遷移。
// ============================================================
import { useEffect, useState } from "react";
import { Icon } from "../components/common/Icon";
import { fetchSummary } from "../lib/summary";
import type { Summary } from "../lib/summary";

const jpNum = (n: number) => n.toLocaleString("ja-JP");

// 未対応バッジ（0件は淡色）
function UnhandledBadge({ n }: { n: number }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[26px] h-[24px] px-2 rounded-full text-sm font-extrabold ${n > 0 ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}`}>
      {n}
    </span>
  );
}

export function SummaryView({ onOpen }: { onOpen: (k: string) => void }) {
  const [data, setData]       = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(false);

  const load = () => {
    setLoading(true); setErr(false);
    fetchSummary()
      .then(setData)
      .catch((e) => { console.warn("サマリー取得に失敗:", e); setErr(true); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const portal = data?.portal ?? { registrants: 0, unhandled: 0 };
  const mails = data?.mails ?? [];
  const lines = data?.lines ?? [];
  const totalUnhandled =
    portal.unhandled + mails.reduce((s, m) => s + m.unhandled, 0) + lines.reduce((s, l) => s + l.unhandled, 0);
  const totalFriends = lines.reduce((s, l) => s + l.friends, 0);

  return (
    // 大枠をウィンドウ高さに自動フィット。本文だけ内部スクロール。
    <div className="h-[calc(100dvh-3rem)] flex flex-col w-full">
      {/* 見出し */}
      <div className="shrink-0 mb-4">
        <div className="text-xs text-slate-500">運営メニュー › <span className="text-slate-700 font-medium">対応</span> › サマリー</div>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-slate-800">サマリー</h1>
          <button onClick={load} disabled={loading}
            className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 disabled:opacity-50">
            {loading ? "更新中…" : "更新"}
          </button>
        </div>
        <p className="text-sm text-slate-500">ポータルトーク・メール・LINE を横断した対応状況の一覧</p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
      {err && (
        <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          データの取得に失敗しました。「更新」で再取得してください。
        </div>
      )}

      {/* KPI */}
      <div className="flex gap-3.5 flex-wrap mb-2">
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">未対応 合計</div>
          <div className="text-2xl font-extrabold text-red-600 mt-0.5">{loading ? "…" : jpNum(totalUnhandled)}<span className="text-xs font-semibold text-slate-500 ml-0.5">件</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">全チャネル横断</div>
        </div>
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">ポータルトーク 登録者</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{loading ? "…" : jpNum(portal.registrants)}<span className="text-xs font-semibold text-slate-500 ml-0.5">人</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">アクティブ会員</div>
        </div>
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">LINE 友だち 合計</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{loading ? "…" : jpNum(totalFriends)}<span className="text-xs font-semibold text-slate-500 ml-0.5">人</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{lines.length}アカウント</div>
        </div>
      </div>

      {/* ポータルトーク */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg bg-red-600 text-white flex items-center justify-center"><Icon name="chat" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">ポータルトーク</h2>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => onOpen("chat")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
            <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500 to-red-700 text-white flex items-center justify-center shrink-0"><Icon name="chat" size={18} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-slate-800">ポータルトーク</span>
              <span className="block text-[11.5px] text-slate-500">会員ポータル内トーク</span>
            </span>
            <span className="flex items-center gap-5">
              <span className="text-right"><span className="block text-[17px] font-extrabold text-slate-800 leading-none">{jpNum(portal.registrants)}</span><span className="block text-[10px] text-slate-500 mt-1">登録者</span></span>
              <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={portal.unhandled} /></span>
              <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
            </span>
          </button>
        </div>
      </section>

      {/* メールアカウント */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg bg-slate-600 text-white flex items-center justify-center"><Icon name="mail" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">メールアカウント</h2>
          <span className="text-[11.5px] text-slate-500 font-semibold">{mails.length}アカウント</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {!loading && mails.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">連携済みのメールアカウントがありません。</div>
          )}
          {mails.map((m) => (
            <button key={m.id} onClick={() => onOpen("mailbox")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
              <span className="w-9 h-9 rounded-lg bg-slate-500 text-white flex items-center justify-center shrink-0"><Icon name="mail" size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{m.address}</span>
                <span className="block text-[11.5px] text-slate-500">{m.desc}</span>
              </span>
              <span className="flex items-center gap-5">
                <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={m.unhandled} /></span>
                <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* LINEアカウント */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg text-white flex items-center justify-center" style={{ background: "#06c755" }}><Icon name="chat" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">LINEアカウント</h2>
          <span className="text-[11.5px] text-slate-500 font-semibold">{lines.length}アカウント</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {!loading && lines.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">連携済みのLINE公式アカウントがありません。</div>
          )}
          {lines.map((l) => (
            <button key={l.id} onClick={() => onOpen("line")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
              <span className="w-9 h-9 rounded-lg text-white flex items-center justify-center shrink-0" style={{ background: "#06c755" }}><Icon name="chat" size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{l.name}</span>
                <span className="block text-[11.5px] text-slate-500">{l.desc}</span>
              </span>
              <span className="flex items-center gap-5">
                <span className="text-right"><span className="block text-[17px] font-extrabold text-slate-800 leading-none">{jpNum(l.friends)}</span><span className="block text-[10px] text-slate-500 mt-1">友だち</span></span>
                <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={l.unhandled} /></span>
                <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="text-[11.5px] text-slate-500 mt-4">
        各行クリックで該当チャネル／アカウントのトーク画面へ遷移します。
      </p>
      </div>
    </div>
  );
}
