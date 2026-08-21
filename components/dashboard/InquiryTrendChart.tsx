"use client";
// ============================================================
// 問合せ数の推移（REQ-027 / P1）
//   フォーム回答の日次件数を単色の棒で出す。
//   ⚠️ 描画ライブラリは追加しない（棒グラフ1つのために依存を増やさない）。
//      div の高さだけで描く。
//   ⚠️ P2 でチャネル別の積み上げに拡張する。そのとき差し替えるのは
//      Bar の中身だけで済むよう、1本 = 1コンポーネントに分けてある。
// ============================================================
import { Icon } from "../common/Icon";
import { CARD, CARD_HEAD, TREND_BAR } from "../../lib/constants";
import type { TrendPoint } from "../../lib/opsDashboard";

/** "2026-08-21" → "8/21" */
function mmdd(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : day;
}

export interface InquiryTrendChartProps {
  points: TrendPoint[];
  days: number;
  loading: boolean;
  /** 期間を広げる（空状態からの導線） */
  onWiden?: () => void;
}

export function InquiryTrendChart({ points, days, loading, onWiden }: InquiryTrendChartProps) {
  const max = points.reduce((m, p) => (p.count > m ? p.count : m), 0);
  const sum = points.reduce((s, p) => s + p.count, 0);
  const avg = points.length > 0 ? sum / points.length : 0;
  // 30日だとラベルが潰れるので1つおきに間引く
  const thin = points.length > 20;

  return (
    <section className={`${CARD} overflow-hidden flex flex-col`}>
      <div className={CARD_HEAD}>
        <Icon name="chart" size={14} />
        <span className="text-[12px] font-bold text-white">問合せ数の推移</span>
        <span className="ml-auto text-[10.5px] font-semibold text-gray-300">直近{days}日・フォーム</span>
      </div>

      {!loading && sum === 0 ? (
        <div className="px-3 py-10 text-center">
          <p className="text-[12px] text-gray-400 mb-2">この期間に問合せはありません</p>
          {onWiden && (
            <button
              type="button"
              onClick={onWiden}
              className="text-[11px] font-bold text-red-700 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50"
            >
              期間を広げる
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-end gap-[3px] h-[132px]">
              {points.map((p, i) => {
                const h = max > 0 ? Math.round((p.count / max) * 108) + 8 : 8;
                const isToday = i === points.length - 1;
                return (
                  <div key={p.day} className="relative flex-1 flex flex-col justify-end items-center gap-0.5 group">
                    <span className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[10px] text-white z-10">
                      {mmdd(p.day)}　{p.count}件
                    </span>
                    <span
                      className={`w-full max-w-[24px] rounded-t ${TREND_BAR}`}
                      style={{ height: `${h}px` }}
                    />
                    <span className={`text-[8px] whitespace-nowrap ${isToday ? "font-bold text-red-600" : "text-gray-400"}`}>
                      {thin && i % 2 === 1 && !isToday ? "" : mmdd(p.day)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-100 text-[10px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${TREND_BAR}`} />
              フォーム回答
            </span>
            <span className="ml-auto tabular-nums">
              期間合計 {loading ? "…" : sum}件／1日平均 {loading ? "…" : avg.toFixed(1)}件
            </span>
          </div>
        </>
      )}
    </section>
  );
}
