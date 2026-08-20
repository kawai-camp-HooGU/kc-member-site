"use client";
// ============================================================
// リスト管理：右ペイン「配信履歴」タブ
//   このリストを宛先に使った配信の一覧。
//   ⚠️ 件数は**送信時点のスナップショット**。後からリストを編集しても変わらない。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../common/Icon";
import { fmtJst } from "../../lib/dateFmt";
import type { ContactList, ListDelivery } from "../../lib/models";
import { fetchListDeliveries, breakdownText } from "../../lib/listDeliveries";
import { BREAKDOWN_LABEL } from "../../lib/listRecipients";

export interface ListDeliveryHistoryProps {
  list: ContactList;
  /** 配信を開く（一斉配信画面へ遷移） */
  onOpenBroadcast?: (broadcastId: number) => void;
}

export function ListDeliveryHistory({ list, onOpenBroadcast }: ListDeliveryHistoryProps) {
  const [rows, setRows] = useState<ListDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await fetchListDeliveries(list.id));
    setLoading(false);
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span className="text-[10.5px] text-gray-500">
          このリストを宛先に使った配信。<b>件数はその時点のスナップショット</b>で、後からリストを編集しても変わりません。
          シナリオは「送信／登録」列がシナリオへ投入した件数です（リストに追加された分は順次投入されます）。
        </span>
        <button onClick={load}
          className="ml-auto text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
          再読込
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="tbl-head">
              {["日時", "種別", "件名／シナリオ名", "チャネル", "対象", "送信／登録", "除外", "除外の内訳", "リスト名（当時）", ""].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">読み込み中...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                このリストを宛先にした配信はまだありません。
              </td></tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50/60">
                <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{fmtJst(d.sentAt)}</td>
                <td className="px-2.5 py-1.5">
                  <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 border bg-blue-50 text-blue-700 border-blue-200 whitespace-nowrap">
                    {d.kind === "scenario" ? "シナリオ" : "一斉配信"}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 max-w-[220px] truncate" title={d.titleSnapshot}>
                  {d.titleSnapshot || "—"}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.channel === "email" ? "メール" : d.channel}</td>
                <td className="px-2.5 py-1.5 font-mono">{d.targetCount.toLocaleString()}</td>
                <td className="px-2.5 py-1.5 font-mono text-emerald-700 font-bold"
                  title={d.kind === "scenario" ? "シナリオに投入した宛先の件数" : "実際に送信した件数"}>
                  {d.sentCount.toLocaleString()}
                </td>
                <td className="px-2.5 py-1.5 font-mono text-amber-700">{d.excludedCount.toLocaleString()}</td>
                <td className="px-2.5 py-1.5 text-[10.5px] text-gray-600 max-w-[200px] truncate"
                  title={breakdownText(d.excludedBreakdown, BREAKDOWN_LABEL)}>
                  {breakdownText(d.excludedBreakdown, BREAKDOWN_LABEL)}
                </td>
                <td className="px-2.5 py-1.5 max-w-[140px] truncate text-gray-500" title={d.listNameSnapshot}>
                  {d.listNameSnapshot || "—"}
                </td>
                <td className="px-2.5 py-1.5">
                  {d.kind === "broadcast" && d.broadcastId != null && onOpenBroadcast ? (
                    <button onClick={() => onOpenBroadcast(d.broadcastId as number)}
                      className="text-[10.5px] font-bold px-2 py-1 rounded-md border border-gray-200 text-gray-600
                        hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap">
                      <Icon name="external" size={12} />配信を開く
                    </button>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
