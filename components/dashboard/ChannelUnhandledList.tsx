"use client";
// ============================================================
// チャネル別 未対応（REQ-027）
//   旧 views/SummaryView.tsx（顧客＞サマリー）の中身をここへ吸収した。
//   行クリックで該当チャネルの画面へ遷移する。
//
//   ⚠️ テーブルではなく div ベースのカードリストで組む。
//      行ごとにアイコン・母数・バッジ・矢印を持つため table に向かない。
//      → brand.md の .tbl-head は対象外（table にするなら必ず付けること）。
// ============================================================
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import { CARD, CARD_HEAD, DASH_CHANNEL_FILL, SUCCESS_CONFIG, unhandledBadgeCls } from "../../lib/constants";
import type { ChannelRow } from "../../lib/opsDashboard";

const jpNum = (n: number): string => n.toLocaleString("ja-JP");

const CH_ICON: Record<ChannelRow["kind"], IconName> = {
  portal: "chat",
  mail:   "mail",
  line:   "messages",
  form:   "form",
};

const GROUP_LABEL: Record<ChannelRow["kind"], string> = {
  portal: "ポータルトーク",
  mail:   "メールアカウント",
  line:   "LINE公式アカウント",
  form:   "フォーム",
};

export interface ChannelUnhandledListProps {
  rows: ChannelRow[];
  loading: boolean;
  noMailAccounts: boolean;
  noLineAccounts: boolean;
  onOpen: (view: string) => void;
  onHover?: (view: string) => void;
  /** 未連携のときの設定導線 */
  onOpenSettings: (view: string) => void;
}

export function ChannelUnhandledList({
  rows, loading, noMailAccounts, noLineAccounts, onOpen, onHover, onOpenSettings,
}: ChannelUnhandledListProps) {
  const active = rows.filter((r) => !r.scopedOut);
  const total = active.reduce((s, r) => s + r.unhandled, 0);

  // 見出しは kind が変わったところにだけ出す（同じ意味を繰り返さない）
  let prevKind: ChannelRow["kind"] | null = null;

  return (
    <section className={`${CARD} overflow-hidden flex flex-col`}>
      <div className={CARD_HEAD}>
        <Icon name="chart" size={14} />
        <span className="text-[12px] font-bold text-white">チャネル別 未対応</span>
        <span className="ml-auto text-[10.5px] font-semibold text-gray-300">クリックで各チャネルへ</span>
      </div>

      {!loading && total === 0 && active.length > 0 && (
        <div className="px-3 py-8 text-center">
          <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${SUCCESS_CONFIG.bg} ${SUCCESS_CONFIG.icon} mb-1.5`}>
            <Icon name="check" size={19} />
          </span>
          <p className={`text-[12.5px] font-bold ${SUCCESS_CONFIG.text} mb-0.5`}>未対応はありません</p>
          <p className="text-[11px] text-gray-400">すべてのチャネルで対応が完了しています</p>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {rows.map((r) => {
          const showHead = r.kind !== prevKind;
          prevKind = r.kind;
          return (
            <div key={r.key}>
              {showHead && (
                <div className="px-3.5 pt-2 pb-1 bg-gray-50 text-[9.5px] font-bold tracking-wider text-gray-400 border-b border-gray-100">
                  {GROUP_LABEL[r.kind]}
                </div>
              )}
              <button
                type="button"
                onClick={() => onOpen(r.view)}
                onMouseEnter={() => onHover?.(r.view)}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50 transition-colors group"
              >
                <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${DASH_CHANNEL_FILL[r.kind]}`}>
                  <Icon name={CH_ICON[r.kind]} size={16} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-bold text-gray-700 truncate">{r.title}</span>
                  {r.desc && <span className="block text-[10px] text-gray-400 truncate">{r.desc}</span>}
                </span>
                {r.people != null && (
                  <span className="text-right shrink-0">
                    <span className="block text-[13px] font-extrabold text-gray-700 leading-none tabular-nums">{jpNum(r.people)}</span>
                    <span className="block text-[9px] text-gray-400 mt-0.5">{r.peopleLabel}</span>
                  </span>
                )}
                {/* ⚠️ 「自分の担当のみ」で対象外の行は 0 ではなく「—」。
                       0 と出すと「自分の担当は0件」と誤読される。 */}
                <span
                  title={r.scopedOut ? "このチャネルには担当者の概念がないため、担当での絞り込み対象外です" : undefined}
                  className={`shrink-0 inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 rounded-full text-[12px] font-extrabold ${
                    r.scopedOut ? "bg-gray-100 text-gray-400" : unhandledBadgeCls(r.unhandled)
                  }`}
                >
                  {loading ? "…" : r.scopedOut ? "—" : r.unhandled}
                </span>
                <span className="shrink-0 text-gray-300 group-hover:text-red-600 transition-colors">›</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* 空状態：未連携は「0件が並ぶ」ではなく、次の1手を出す */}
      {!loading && noMailAccounts && (
        <EmptyLink text="メールアカウントが未連携です" action="メール設定を開く" onClick={() => onOpenSettings("mail")} />
      )}
      {!loading && noLineAccounts && (
        <EmptyLink text="LINE公式アカウントが未連携です" action="LINE設定を開く" onClick={() => onOpenSettings("line-accounts")} />
      )}
    </section>
  );
}

function EmptyLink({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div className="px-3.5 py-3 border-t border-gray-100 flex items-center gap-2.5">
      <span className="text-[11.5px] text-gray-400">{text}</span>
      <button
        type="button"
        onClick={onClick}
        className="ml-auto text-[11px] font-bold text-red-700 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50"
      >
        {action}
      </button>
    </div>
  );
}
