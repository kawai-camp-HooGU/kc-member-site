"use client";
// ============================================================
// 入出金の一括取込：プレビュー（ステップ④）
//
//   1行＝1着金。内訳モードでは、その着金にぶら下がる消込を展開して見せる。
//
//   ⚠️ ここで見せるべきは「いくら着金し、何に消し込み、差額がいくら出るか」の3点。
//      差額が許容枠を超えている行は、取り込む前に必ず目に入るようにする。
// ============================================================
import { Fragment, useState } from "react";
import { formatYen } from "../../lib/payments";
import { ADJUSTMENT_LABEL, DEFAULT_TOLERANCE } from "../../lib/cash";
import {
  CASH_VERDICT_LABEL, willImportCash,
  type CashImportGroup, type CashImportMode,
} from "../../lib/cashImport";
import type { PaymentMaster } from "../../lib/models";

const pill: Record<string, string> = {
  ok:         "bg-emerald-50 text-emerald-700 border-emerald-200",
  dup_payout: "bg-amber-50 text-amber-700 border-amber-200",
  dup_file:   "bg-amber-50 text-amber-700 border-amber-200",
  error:      "bg-red-50 text-red-700 border-red-200",
};

export interface CashImportPreviewProps {
  groups: CashImportGroup[];
  mode: CashImportMode;
  sites: PaymentMaster[];
  filter: "all" | "ok" | "dup" | "error";
  onToggleOverride: (no: number) => void;
}

export function CashImportPreview({ groups, mode, sites, filter, onToggleOverride }: CashImportPreviewProps) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (no: number) =>
    setOpen((prev) => { const s = new Set(prev); s.has(no) ? s.delete(no) : s.add(no); return s; });

  const siteName = (id: number | null) =>
    id == null ? "—" : sites.find((s) => s.id === id)?.name ?? `不明(#${id})`;

  const shown = groups.filter((g) => {
    if (filter === "all") return true;
    if (filter === "error") return g.verdict === "error";
    if (filter === "ok") return willImportCash(g);
    return g.verdict !== "error" && !willImportCash(g);
  });

  if (!shown.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl text-center text-gray-300 py-12 text-sm">
        該当する行がありません。
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0">
            <tr className="bg-gray-700 text-gray-100">
              <th className="text-left font-bold px-3 py-2 w-10">#</th>
              <th className="text-left font-bold px-3 py-2 whitespace-nowrap">判定</th>
              <th className="text-left font-bold px-3 py-2 whitespace-nowrap">入出金日</th>
              <th className="text-left font-bold px-3 py-2 whitespace-nowrap">区分</th>
              <th className="text-left font-bold px-3 py-2 whitespace-nowrap">経路</th>
              <th className="text-left font-bold px-3 py-2">摘要・入金ID</th>
              <th className="text-right font-bold px-3 py-2 whitespace-nowrap">実着金額</th>
              {mode === "breakdown" && <th className="text-right font-bold px-3 py-2 whitespace-nowrap">充当額</th>}
              {mode === "breakdown" && <th className="text-right font-bold px-3 py-2 whitespace-nowrap">差額</th>}
              {mode === "breakdown" && <th className="text-left font-bold px-3 py-2 whitespace-nowrap">消込</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => {
              const e = g.entry;
              const matched = g.allocations.filter((a) => a.sourceId != null && a.amount > 0);
              const allocated = matched.reduce((s, a) => s + a.amount, 0);
              const isOpen = open.has(g.no) || g.verdict !== "ok" || (g.diff !== 0 && !g.autoAdjust);
              const label = willImportCash(g) ? "取込" : CASH_VERDICT_LABEL[g.verdict];
              const cls = willImportCash(g) ? pill.ok : pill[g.verdict];
              const cols = mode === "breakdown" ? 10 : 7;
              return (
                <Fragment key={g.no}>
                  <tr className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-400">{g.no}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggle(g.no)}
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
                        {label}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{e.entryDate || "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${e.direction === "in"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-red-50 text-red-700 border-red-200"}`}>
                        {e.direction === "in" ? "入金" : "出金"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{siteName(e.siteId)}</td>
                    <td className="px-3 py-1.5 max-w-[240px]">
                      <div className="text-gray-800 truncate" title={e.description}>{e.description || "—"}</div>
                      {e.externalPayoutId && (
                        <div className="text-[10.5px] font-mono text-gray-400 truncate">{e.externalPayoutId}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold text-gray-800">
                      {e.amount ? formatYen(e.amount) : "—"}
                    </td>
                    {mode === "breakdown" && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {allocated ? formatYen(allocated) : "—"}
                      </td>
                    )}
                    {mode === "breakdown" && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {g.diff === 0
                          ? <span className="text-gray-300">—</span>
                          : (
                            <span className={g.autoAdjust ? "text-amber-700 font-semibold" : "text-red-700 font-bold"}>
                              {g.diff > 0 ? "−" : "＋"}{formatYen(Math.abs(g.diff))}
                            </span>
                          )}
                      </td>
                    )}
                    {mode === "breakdown" && (
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                        {matched.length}件
                        {g.allocations.length > matched.length && (
                          <span className="ml-1 text-[10px] font-bold text-red-600">
                            未一致 {g.allocations.length - matched.length}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>

                  {isOpen && (g.reasons.length > 0 || matched.length > 0 || g.adjustment) && (
                    <tr className="bg-[#fafafa]">
                      <td />
                      <td colSpan={cols - 1} className="px-3 pb-2.5 pt-0">
                        {g.reasons.length > 0 && (
                          <div className="text-[11.5px] text-gray-600 leading-relaxed">
                            {g.reasons.map((m, k) => <div key={k}>└ {m}</div>)}
                          </div>
                        )}

                        {g.canOverride && (
                          <label className="inline-flex items-center gap-1.5 mt-1 text-[11.5px] text-gray-700 cursor-pointer">
                            <input type="checkbox" checked={g.override} onChange={() => onToggleOverride(g.no)}
                              className="w-3.5 h-3.5 accent-emerald-600" />
                            この入出金はやはり取り込む
                          </label>
                        )}
                        {g.verdict === "dup_payout" && (
                          <div className="text-[11.5px] text-gray-400 mt-0.5">
                            → スキップ（入金IDの一致は変更できません）
                          </div>
                        )}

                        {g.adjustment && (
                          <div className={`mt-1.5 text-[11.5px] rounded-lg px-3 py-2 border ${g.autoAdjust
                            ? "bg-amber-50 border-amber-200 text-amber-800"
                            : "bg-red-50 border-red-200 text-red-700"}`}>
                            差額 {formatYen(Math.abs(g.diff))} を
                            <b>「{ADJUSTMENT_LABEL[g.adjustment.kind]}」</b>として、
                            この入出金に1行で持たせます（明細には按分しません）。
                            <div className="mt-0.5">{g.adjustReason}</div>
                            {!g.autoAdjust && (
                              <div className="mt-0.5 font-bold">
                                許容枠（±{DEFAULT_TOLERANCE.toLocaleString("ja-JP")}円）の外です。
                                取り込む前に消込の内容を確認してください。
                              </div>
                            )}
                          </div>
                        )}

                        {matched.length > 0 && (
                          <table className="w-full text-[11.5px] mt-1.5">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left font-semibold py-1">行</th>
                                <th className="text-left font-semibold py-1">決済ID</th>
                                <th className="text-left font-semibold py-1">消込先</th>
                                <th className="text-right font-semibold py-1">充当額</th>
                                <th className="text-left font-semibold py-1 pl-3">備考</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matched.map((a) => (
                                <tr key={`${a.rowNo}-${a.externalTxnId}`} className="border-t border-gray-200">
                                  <td className="py-1 text-gray-400">{a.rowNo}</td>
                                  <td className="py-1 font-mono text-gray-600 max-w-[180px] truncate" title={a.externalTxnId}>{a.externalTxnId}</td>
                                  <td className="py-1 text-gray-600 whitespace-nowrap">
                                    {a.sourceType === "expense" ? "経費" : "売上"} #{a.sourceId}
                                  </td>
                                  <td className="py-1 text-right tabular-nums text-gray-700">{formatYen(a.amount)}</td>
                                  <td className="py-1 pl-3 text-amber-700">{a.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
