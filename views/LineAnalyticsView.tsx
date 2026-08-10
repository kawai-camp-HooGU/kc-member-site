"use client";
// LINE分析ダッシュボード（Phase 7④）：KPI・友だち増減・流入経路別・配信効果。
import { useCallback, useEffect, useState } from "react";
import { useLineAccounts } from "../hooks/useLineAccounts";
import { fetchLineStats } from "../lib/lineAnalytics";
import type { LineStats } from "../lib/lineAnalytics";
import { LineAccountBar } from "../components/line/LineAccountBar";

const card = "bg-white border border-gray-200 rounded-2xl";

export function LineAnalyticsView() {
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const [stats, setStats] = useState<LineStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setStats(await fetchLineStats(accountId));
    setLoading(false);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const maxNet = stats ? Math.max(1, ...stats.growth.map((g) => Math.max(g.follows, g.unfollows))) : 1;

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="分析" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />
      <div className="flex-1 overflow-auto p-5">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-lg font-extrabold">LINE分析</h1>
          <span className="text-xs text-gray-500">友だち・流入経路・配信効果</span>
          <button onClick={load} className="ml-auto text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">更新</button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-16 text-center">読み込み中…</div>
        ) : !stats ? (
          <div className="text-sm text-gray-400 py-16 text-center">アカウントを選択してください。</div>
        ) : (
          <div className="space-y-4">
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className={`${card} p-4`}><div className="text-[11px] text-gray-500">友だち総数</div><div className="text-2xl font-extrabold">{stats.total.toLocaleString()}</div></div>
              <div className={`${card} p-4`}><div className="text-[11px] text-gray-500">会員連携率</div><div className="text-2xl font-extrabold text-emerald-700">{stats.linkedRate}%</div><div className="text-[11px] text-gray-400">{stats.linked.toLocaleString()} 人</div></div>
              <div className={`${card} p-4`}><div className="text-[11px] text-gray-500">ブロック率</div><div className="text-2xl font-extrabold text-amber-700">{stats.blockRate}%</div><div className="text-[11px] text-gray-400">{stats.blockedEver.toLocaleString()} 人</div></div>
              <div className={`${card} p-4`}><div className="text-[11px] text-gray-500">直近の純増（今週）</div><div className="text-2xl font-extrabold">{(stats.growth.at(-1)?.net ?? 0) >= 0 ? "＋" : ""}{stats.growth.at(-1)?.net ?? 0}</div></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 友だち増減 */}
              <div className={`${card} p-4`}>
                <div className="font-bold text-sm mb-3">友だち増減（直近12週）</div>
                <div className="flex items-end gap-1 h-[140px] border-b border-gray-100 pb-1">
                  {stats.growth.map((g, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                      <div className="w-full flex items-end justify-center gap-0.5 h-full">
                        <div title={`追加 ${g.follows}`} style={{ height: `${(g.follows / maxNet) * 100}%` }} className="w-1.5 bg-emerald-500 rounded-t" />
                        <div title={`解除 ${g.unfollows}`} style={{ height: `${(g.unfollows / maxNet) * 100}%` }} className="w-1.5 bg-gray-300 rounded-t" />
                      </div>
                      <div className="text-[9px] text-gray-400">{i % 2 === 0 ? g.label : ""}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-2 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500" />友だち追加</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-300" />ブロック/解除</span>
                </div>
              </div>

              {/* 流入経路別 */}
              <div className={`${card} p-4`}>
                <div className="font-bold text-sm mb-3">流入経路別 友だち数</div>
                {stats.sources.length === 0 ? (
                  <div className="text-[12px] text-gray-400 py-6 text-center">データがありません。</div>
                ) : (
                  <table className="w-full text-[12.5px]">
                    <thead><tr className="text-gray-500"><th className="text-left font-semibold pb-1">経路</th><th className="text-right font-semibold pb-1">友だち</th><th className="text-right font-semibold pb-1">連携</th><th className="text-right font-semibold pb-1">連携率</th></tr></thead>
                    <tbody>
                      {stats.sources.map((s, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-1.5">{s.label}</td>
                          <td className="py-1.5 text-right font-bold">{s.friends}</td>
                          <td className="py-1.5 text-right">{s.linked}</td>
                          <td className="py-1.5 text-right text-gray-500">{s.friends ? Math.round((s.linked / s.friends) * 100) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* 経路別ブロック分析 */}
            <div className={`${card} p-4`}>
              <div className="font-bold text-sm mb-3">経路別ブロック分析 <span className="text-[11px] text-gray-400 font-normal">登録総数に対する現在のブロック/解除率</span></div>
              {stats.sourceBlocks.length === 0 ? (
                <div className="text-[12px] text-gray-400 py-6 text-center">データがありません。</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-gray-500"><th className="text-left font-semibold pb-1">経路</th><th className="text-right font-semibold pb-1">登録総数</th><th className="text-right font-semibold pb-1">ブロック</th><th className="text-right font-semibold pb-1">ブロック率</th></tr></thead>
                  <tbody>
                    {stats.sourceBlocks.map((s, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1.5">{s.label}</td>
                        <td className="py-1.5 text-right font-bold">{s.total}</td>
                        <td className="py-1.5 text-right">{s.blocked}</td>
                        <td className={`py-1.5 text-right font-bold ${s.blockRate >= 20 ? "text-red-600" : s.blockRate >= 10 ? "text-amber-600" : "text-gray-600"}`}>{s.blockRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-gray-400 mt-2">※ ブロック率が高い経路は、訴求内容や配信頻度の見直しが有効です。増減の推移は上のグラフ（直近12週）を参照。</p>
            </div>

            {/* 配信効果 */}
            <div className={`${card} p-4`}>
              <div className="font-bold text-sm mb-3">LINE配信の効果（直近）</div>
              {stats.broadcasts.length === 0 ? (
                <div className="text-[12px] text-gray-400 py-6 text-center">LINE配信の実績がまだありません。</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-gray-500"><th className="text-left font-semibold pb-1">配信</th><th className="text-left font-semibold pb-1">送信日</th><th className="text-right font-semibold pb-1">送信</th><th className="text-right font-semibold pb-1">クリック</th><th className="text-right font-semibold pb-1">率</th></tr></thead>
                  <tbody>
                    {stats.broadcasts.map((b) => (
                      <tr key={b.id} className="border-t border-gray-100">
                        <td className="py-1.5">{b.title}</td>
                        <td className="py-1.5 text-gray-500">{b.sentAt}</td>
                        <td className="py-1.5 text-right font-bold">{b.sent.toLocaleString()}</td>
                        <td className="py-1.5 text-right">{b.clicks.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-emerald-700 font-bold">{b.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-gray-400 mt-2">※ クリックは配信本文のURL（計測リンク）から集計。LINEは全員同一本文のため配信単位の集計です（個人別ではありません）。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
