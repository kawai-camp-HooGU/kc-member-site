"use client";
// ============================================================
// 運営ダッシュボード（REQ-027）
//
//   /ops の着地画面。運営がログインした瞬間に「今日やること」が目に入る状態を作る。
//   旧「顧客＞サマリー」の集計はこの画面に吸収した（SummaryView は廃止）。
//
//   構成（設計書 §4-2）
//     0段 ヘッダ   … 最終更新・更新ボタン・範囲（全体/自分のみ）・期間（7/14/30日）
//     1段 KPI ×5   … 未対応合計／最長待ち／今日のフォーム回答／未照合の決済／名寄せ要対応
//     2段 左       … チャネル別 未対応（旧サマリーの中身）
//         右       … 待たせている順 Top5（P2-a）
//     3段          … 問合せ数の推移（フォームのみ・日次）
//
//   ⚠️ この画面に不可逆な操作（削除・配信・課金）は置かない。「見る画面」に留める。
//   ⚠️ 未読の総数は app.tsx が持っている値を props で受け取る。ここで取り直すと
//      サイドバーのバッジと食い違う（設計書 §9-3）。
//   ⚠️ 状態（期間・範囲）は URL クエリに置く（routes.ts の「画面はパス・状態はクエリ」）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { useMaster } from "../hooks/useMaster";
import { Icon } from "../components/common/Icon";
import { KpiCard } from "../components/dashboard/KpiCard";
import { ChannelUnhandledList } from "../components/dashboard/ChannelUnhandledList";
import { InquiryTrendChart } from "../components/dashboard/InquiryTrendChart";
import { OldestWaitingList } from "../components/dashboard/OldestWaitingList";
import { DASH_REFRESH_MS, TREND_RANGES, TREND_RANGE_DEFAULT } from "../lib/constants";
import { errMessage } from "../lib/errors";
import { fetchOpsDashboard, elapsedLabel } from "../lib/opsDashboard";
import type { OpsDashboard } from "../lib/opsDashboard";

export interface OpsDashboardViewProps {
  /** サイドバーと同じ未読数（app.tsx の useChatUnread / useLineUnread） */
  chatUnread: number;
  lineUnread: number;
  /** サイドバーと同じ遷移（view キー） */
  onOpen: (view: string) => void;
  /** 静的ルート（/ops/submissions/[id] 等）への遷移 */
  onOpenHref: (href: string) => void;
  /** 遷移先の先読み（体感速度対策。既存サイドバーと同じ作法） */
  onPrefetch?: (view: string) => void;
}

const jstTime = (d: Date): string =>
  d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export function OpsDashboardView({ chatUnread, lineUnread, onOpen, onOpenHref, onPrefetch }: OpsDashboardViewProps) {
  const route = useRoute();
  const { members, permission } = useMaster();

  // ── 状態は URL クエリから導出する ──
  const rawDays = route.qNum("d");
  const days = rawDays != null && TREND_RANGES.includes(rawDays) ? rawDays : TREND_RANGE_DEFAULT;
  const mine = route.q("scope") === "mine" && permission.myId != null;

  const [data, setData]           = useState<OpsDashboard | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchOpsDashboard({
      days,
      unread: { portal: chatUnread, line: lineUnread },
      assigneeId: mine ? permission.myId : null,
    })
      .then((d) => {
        setData(d);
        setUpdatedAt(new Date());
        setErr(d.partial ? "一部のデータを取得できませんでした。「更新」で再取得してください。" : "");
      })
      .catch((e: unknown) => setErr(errMessage(e, "データの取得に失敗しました。「更新」で再取得してください。")))
      .finally(() => setLoading(false));
  }, [days, mine, permission.myId, chatUnread, lineUnread]);

  useEffect(() => { load(); }, [load]);

  // 自動更新。⚠️ タブが前面のときだけ回す（裏タブで無駄なクエリを打ち続けない）
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, DASH_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // 表示中は遷移先を先読みしておく（全行がリンクのため）
  useEffect(() => {
    if (!onPrefetch) return;
    ["chat", "mailbox", "line", "form", "payments", "line-match"].forEach(onPrefetch);
  }, [onPrefetch]);

  const assigneeName = useCallback(
    (id: string): string => members.find((m) => String(m.id) === id)?.name ?? `#${id}`,
    [members],
  );

  const num = (n: number | undefined): string => (loading && data == null ? "…" : String(n ?? 0));
  const diff = data ? data.todayForms - data.yesterdayForms : 0;

  return (
    // 大枠をウィンドウ高さに自動フィット。本文だけ内部スクロール（既存画面と同じ作法）。
    <div className="h-[calc(100dvh-3rem)] flex flex-col w-full">
      {/* ── ヘッダ ── */}
      <div className="shrink-0 mb-3">
        <div className="text-xs text-slate-500">
          運営メニュー › <span className="text-slate-700 font-medium">ホーム</span> › ダッシュボード
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>
          <span className="text-[11px] text-slate-400">
            最終更新 {updatedAt ? jstTime(updatedAt) : "—"}　自動更新 {DASH_REFRESH_MS / 1000}秒
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "更新中…" : "更新"}
          </button>

          <span className="ml-auto flex items-center gap-2">
            {/* 範囲：語彙は進行状況画面（DashboardView）と揃える */}
            <span className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white">
              {[{ k: "all", label: "全体" }, { k: "mine", label: "自分のみ" }].map((o) => {
                const on = (o.k === "mine") === mine;
                return (
                  <button
                    key={o.k}
                    type="button"
                    disabled={o.k === "mine" && permission.myId == null}
                    onClick={() => route.setQuery({ scope: o.k === "mine" ? "mine" : null })}
                    className={`text-[10.5px] font-bold px-2.5 py-1 disabled:opacity-40 ${on ? "bg-[#3f3f46] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </span>
            {/* 期間 */}
            <span className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white">
              {TREND_RANGES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => route.setQuery({ d: d === TREND_RANGE_DEFAULT ? null : d })}
                  className={`text-[10.5px] font-bold px-2.5 py-1 ${d === days ? "bg-[#3f3f46] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {d}日
                </button>
              ))}
            </span>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1 pb-4">
        {err && (
          <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {mine && (
          <div className="mb-3 text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            「自分のみ」表示中です。担当者を持つのは<b className="font-bold">フォーム回答</b>だけのため、
            トーク・メール・LINE は集計対象外（「—」）になります。
          </div>
        )}

        {/* ── 1段：KPI ×5 ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 mb-3">
          {/* 合計はクリックさせない（内訳へ誘導するための見出し） */}
          <KpiCard
            icon="chart"
            label="未対応 合計"
            value={num(data?.unhandledTotal)}
            unit="件"
            note="未読・未処理の件数"
            tone={data && data.unhandledTotal > 0 ? "alert" : data ? "calm" : "plain"}
          />
          <KpiCard
            icon="clock"
            label="最長待ち"
            value={data?.oldest ? elapsedLabel(data.oldest.elapsedMs) : loading ? "…" : "—"}
            note={data?.oldest ? data.oldest.desc : "待たせている案件はありません"}
            tone={data?.oldest ? "alert" : "plain"}
            onClick={data?.oldest ? () => onOpenHref(data.oldest?.href ?? "/ops") : undefined}
          />
          <KpiCard
            icon="form"
            label="今日のフォーム回答"
            value={num(data?.todayForms)}
            unit="件"
            note={data ? `昨日 ${data.yesterdayForms}件　${diff >= 0 ? "+" : ""}${diff}` : undefined}
            onClick={() => onOpen("form")}
            onHover={() => onPrefetch?.("form")}
          />
          <KpiCard
            icon="doc"
            label="未照合の決済"
            value={num(data?.unmatchedPayments)}
            unit="件"
            note={data?.oldestPaymentMs != null ? `最古 ${elapsedLabel(data.oldestPaymentMs)}前` : "—"}
            tone={data && data.unmatchedPayments > 0 ? "alert" : "plain"}
            onClick={() => onOpen("payments")}
            onHover={() => onPrefetch?.("payments")}
          />
          <KpiCard
            icon="shield"
            label="名寄せ 要対応"
            value={num(data?.linkQueue)}
            unit="件"
            note="LINE 友だち ↔ 会員"
            tone={data && data.linkQueue > 0 ? "alert" : "plain"}
            onClick={() => onOpen("line-match")}
            onHover={() => onPrefetch?.("line-match")}
          />
        </div>

        {/* ── 2段：チャネル別 未対応／待たせている順 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
          <div className="lg:col-span-2">
            <ChannelUnhandledList
              rows={data?.channels ?? []}
              loading={loading && data == null}
              noMailAccounts={data?.noMailAccounts ?? false}
              noLineAccounts={data?.noLineAccounts ?? false}
              onOpen={onOpen}
              onHover={onPrefetch}
              onOpenSettings={onOpen}
            />
          </div>
          <OldestWaitingList
            items={data?.waiting ?? []}
            loading={loading && data == null}
            assigneeName={assigneeName}
            onOpenHref={onOpenHref}
          />
        </div>

        {/* ── 3段：問合せ数の推移 ── */}
        <InquiryTrendChart
          points={data?.trend ?? []}
          days={days}
          loading={loading && data == null}
          onWiden={days < 30 ? () => route.setQuery({ d: 30 }) : undefined}
        />

        <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
          <Icon name="help" size={12} />
          「未対応」は未読・未処理の件数です（開いた時点で既読になるチャネルがあります）。
        </p>
      </div>
    </div>
  );
}
