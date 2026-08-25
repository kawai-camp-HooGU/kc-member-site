"use client";
// ============================================================
// 利益分配レポート（独立ルート /ops/share）
//
//   この機能の最終目的。売上明細ごとに「誰にいくら分配するか」を出す。
//
//   ＜按分ベース＞（確認事項3a＋）
//     計上金額（総額 − 決済手数料）から返金を控除した額。
//     振込手数料は按分せず、月次の共通経費として1本で計上する。
//     → **売上が確定した時点で分配額が出せる**（着金を待たない）。
//
//   ＜月次の確定＞
//     確定すると分配額をスナップショットとして焼き、以降は再計算しない。
//     支払い済みの金額が、あとから売上を直したせいで動くのを防ぐ。
//     確定した月の売上は一括取込からも取り消せなくなる（設計書 §6-5）。
//
//   ⚠️ 初回／2回目以降の判定には**全期間の決済**が要る。当月分だけで判定すると、
//      去年から続いている会員の当月分が「初回」になり初回レートで払ってしまう。
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fetchPayments, fetchMasterOptions, formatYen } from "../../lib/payments";
import { fetchRefunds, fetchRefundMasterOptions, doneStatusIds } from "../../lib/refunds";
import {
  buildShareEntries, describeRule, monthRange, negativePartners, toEntryCsv, toPartnerCsv,
  totalizeByPartner, totalizeShare, TIER_LABEL,
} from "../../lib/profitShare";
import {
  fetchPartners, fetchShareEntries, fetchShareRules, fetchSharePeriods, fixPeriod,
  hasCycle, newPartner, newShareRule, savePartner, saveShareRule, shareAvailable,
  unfixPeriod, validateRule,
} from "../../lib/profitShareRun";
import type {
  Partner, Payment, PaymentMaster, Refund, ShareEntry, SharePeriod, ShareRule,
} from "../../lib/models";
import { useMaster } from "../../hooks/useMaster";
import { useToast } from "../common/ToastProvider";
import { useConfirm } from "../common/ConfirmProvider";
import { SaveButton } from "../common/SaveButton";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

type Tab = "report" | "rules";

const btn = "px-3 py-2 rounded-lg text-sm font-semibold";
const btnGhost = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40`;
const btnMain = `${btn} bg-red-600 text-white hover:bg-red-700 disabled:opacity-40`;

const thisMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** 符号付きの金額。分配＝黒／戻し＝赤 */
function Signed({ v }: { v: number }) {
  if (v === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className={`font-bold tabular-nums ${v > 0 ? "text-gray-800" : "text-red-600"}`}>
      {v > 0 ? "" : "− "}{formatYen(Math.abs(v))}
    </span>
  );
}

function download(text: string, filename: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ProfitShareView() {
  const { can } = useMaster();
  const toast = useToast();
  const confirm = useConfirm();
  const canEditRules = can("share_master");
  const canFix = can("share_fix");
  const canExport = can("share_export");

  const [tab, setTab] = useState<Tab>("report");
  const [period, setPeriod] = useState(thisMonth());
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [doneIds, setDoneIds] = useState<ReadonlySet<number>>(new Set<number>());
  const [types, setTypes] = useState<PaymentMaster[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [rules, setRules] = useState<ShareRule[]>([]);
  const [periods, setPeriods] = useState<SharePeriod[]>([]);
  /** 確定済み月のスナップショット（読み込めたら再計算しない） */
  const [snapshot, setSnapshot] = useState<ShareEntry[] | null>(null);

  const [pEdit, setPEdit] = useState<Partner | null>(null);
  const [rEdit, setREdit] = useState<ShareRule | null>(null);
  const [openPartner, setOpenPartner] = useState<number | null>(null);

  const loadMasters = useCallback(async () => {
    const [ps, rs, pes] = await Promise.all([
      fetchPartners().catch(() => [] as Partner[]),
      fetchShareRules().catch(() => [] as ShareRule[]),
      fetchSharePeriods().catch(() => [] as SharePeriod[]),
    ]);
    setPartners(ps); setRules(rs); setPeriods(pes);
    setUnavailable(shareAvailable() === false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // ⚠️ 決済は期間で絞らず全件取る。初回判定と返金の元決済引き当てに要る
        const [pay, m] = await Promise.all([fetchPayments(), fetchMasterOptions()]);
        setPayments(pay); setTypes(m.types);
        try {
          const [rs, opts] = await Promise.all([fetchRefunds(), fetchRefundMasterOptions()]);
          setRefunds(rs); setDoneIds(doneStatusIds(opts.refund_status));
        } catch { /* 返金が未導入・権限なしでもレポートは出す */ }
        await loadMasters();
      } catch (e) {
        console.error("利益分配の読込エラー:", e);
      }
      setLoading(false);
    })();
  }, [loadMasters]);

  const current = useMemo(() => periods.find((p) => p.period === period) ?? null, [periods, period]);
  const isFixed = current?.status === "fixed";

  // 確定済みなら焼いたスナップショットを読む（再計算しない）
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isFixed) { setSnapshot(null); return; }
      const es = await fetchShareEntries(period);
      if (alive) setSnapshot(es);
    })();
    return () => { alive = false; };
  }, [isFixed, period]);

  const { from, to } = monthRange(period);

  const computed = useMemo(
    () => buildShareEntries({ from, to, payments, refunds, refundDoneIds: doneIds, partners, rules }),
    [from, to, payments, refunds, doneIds, partners, rules],
  );

  const entries = snapshot ?? computed.entries;
  const warnings = snapshot ? [] : computed.warnings;
  const byPartner = useMemo(() => totalizeByPartner(entries, partners), [entries, partners]);
  const totals = useMemo(() => totalizeShare(entries), [entries]);
  const negatives = useMemo(() => negativePartners(byPartner), [byPartner]);

  const typeName = (id: number | null) =>
    id == null ? "—" : types.find((t) => t.id === id)?.name ?? `不明(#${id})`;
  const partnerName = (id: number) =>
    partners.find((p) => p.id === id)?.name ?? `不明(#${id})`;

  // ── 確定 ──
  const doFix = async () => {
    if (!entries.length) { toast.error("分配する明細がありません"); return; }
    if (!(await confirm({
      title: `${period} を確定する`,
      message: `${byPartner.length}名・${formatYen(totals.share)} の分配を確定します。`
        + "確定するとこの月の分配額は再計算されず、対象の売上は一括取込から取り消せなくなります。",
      confirmLabel: "確定する",
    }))) return;
    const res = await fixPeriod(period, computed.entries, { base: totals.base, share: totals.share });
    if (!res.ok) { toast.error(`確定に失敗しました：${res.error}`); return; }
    await loadMasters();
    toast.success(`${period} を確定しました`);
  };

  const doUnfix = async () => {
    if (!(await confirm({
      title: `${period} の確定を解除する`,
      message: "解除するとスナップショットを削除し、以降は最新の売上・返金から再計算します。"
        + "すでにパートナーへ支払っている場合、金額が変わる可能性があります。",
      confirmLabel: "解除する", danger: true,
    }))) return;
    const res = await unfixPeriod(period);
    if (!res.ok) { toast.error(`解除に失敗しました：${res.error}`); return; }
    await loadMasters();
    toast.success("確定を解除しました");
  };

  // ── マスタ保存 ──
  const doSavePartner = async () => {
    if (!pEdit) return;
    if (!pEdit.name.trim()) { toast.error("分配先の名称を入力してください"); return; }
    if (hasCycle(partners, pEdit.id, pEdit.parentPartnerId)) {
      toast.error("紹介元のたどり先が循環しています（AがBの紹介元、BがAの紹介元 など）");
      return;
    }
    const res = await savePartner(pEdit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setPEdit(null); await loadMasters();
    toast.success("保存しました");
  };

  const doSaveRule = async () => {
    if (!rEdit) return;
    const errs = validateRule(rEdit);
    if (errs.length) { toast.error(errs[0]); return; }
    const res = await saveShareRule(rEdit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setREdit(null); await loadMasters();
    toast.success("保存しました");
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">利益分配</h1>
        <span className="text-xs text-gray-400">
          按分ベースは「総額 − 決済手数料 − 返金」。振込手数料は共通経費として按分しません。
        </span>
      </div>

      {unavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[12.5px] font-bold text-amber-800">分配のテーブルがまだありません</div>
          <p className="text-[11.5px] text-amber-700 mt-1">
            この画面を使うには <code className="font-mono">supabase/migration_add_profit_share.sql</code> の適用が必要です。
            適用すると、分配先・分配ルールの登録と月次の確定が使えるようになります。
          </p>
        </div>
      )}

      {/* タブ */}
      <div className="flex items-end gap-1 border-b border-gray-200">
        {([["report", "分配レポート"], ["rules", "分配先とルール"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm font-bold rounded-t-lg border border-b-0 -mb-px ${tab === v
              ? "border-gray-200 bg-white text-red-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "report" ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="month" className={`${input} w-auto bg-white`} value={period}
              onChange={(e) => setPeriod(e.target.value)} />
            <span className="text-[11.5px] text-gray-400">{from} 〜 {to}（計上日）</span>
            {isFixed ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1">
                確定済み{current?.fixedAt ? `（${current.fixedAt.slice(0, 10)}）` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1">
                下書き
              </span>
            )}
            <div className="flex-1" />
            {canExport && (
              <>
                <button onClick={() => download(toPartnerCsv(byPartner), `利益分配_${period}_分配先別.csv`)}
                  disabled={!byPartner.length} className={btnGhost}>
                  分配先別CSV
                </button>
                <button onClick={() => download(toEntryCsv(entries, partners), `利益分配_${period}_明細.csv`)}
                  disabled={!entries.length} className={btnGhost}>
                  明細CSV
                </button>
              </>
            )}
            {canFix && (isFixed
              ? <button onClick={doUnfix} className={`${btn} border border-red-300 text-red-600 hover:bg-red-50`}>確定を解除</button>
              : <button onClick={doFix} disabled={!entries.length || unavailable} className={btnMain}>この月を確定する</button>
            )}
          </div>

          {isFixed && (
            <p className="text-[11.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
              確定済みのため、<b>保存された分配額をそのまま表示しています</b>（再計算していません）。
              確定後に売上や返金を直しても、この月の金額は動きません。
            </p>
          )}

          {/* サマリ */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">按分ベース</div><div className="text-xl font-bold text-gray-800">{formatYen(totals.base)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">分配額</div><div className="text-xl font-bold text-red-600">− {formatYen(totals.share)}</div></div>
            <div className="bg-gray-800 rounded-xl px-4 py-3"><div className="text-[11px] text-gray-300">会社に残る</div><div className="text-xl font-bold text-white">{formatYen(totals.remain)}</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">分配先</div><div className="text-xl font-bold text-gray-800">{totals.partners} 名</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">明細</div><div className="text-xl font-bold text-gray-800">{totals.entries} 件</div></div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="text-[12.5px] font-bold text-amber-800">確認してください（{warnings.length}件）</div>
              <ul className="text-[11.5px] text-amber-800 mt-1 space-y-0.5">
                {warnings.slice(0, 12).map((w, i) => <li key={i}>・{w}</li>)}
                {warnings.length > 12 && <li>ほか {warnings.length - 12} 件</li>}
              </ul>
            </div>
          )}

          {negatives.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11.5px] text-red-700">
              <b>支払額がマイナスの分配先があります</b>（返金の戻しが今月の分配を上回っています）：
              {negatives.map((t) => `${t.name}（${formatYen(t.net)}）`).join("・")}
              <div className="text-red-600 mt-1">翌月に繰り越すか、個別に精算するかを決めてから確定してください。</div>
            </div>
          )}

          {/* 分配先別 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {byPartner.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">
                この月に分配対象がありません。
                {!rules.length && <button onClick={() => setTab("rules")} className="text-red-500 hover:text-red-700 underline ml-1">分配ルール</button>}
                {!rules.length && "を先に登録してください。"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-gray-700 text-gray-100">
                      <th className="text-left font-bold px-3 py-2">分配先</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">売上ぶん</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">返金の戻し</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">うち紹介元報酬</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">差引支払額</th>
                      <th className="text-right font-bold px-3 py-2 whitespace-nowrap">件数</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {byPartner.map((t) => {
                      const open = openPartner === t.partnerId;
                      const rows = open ? entries.filter((e) => e.partnerId === t.partnerId) : [];
                      return (
                        <Fragment key={t.partnerId}>
                          <tr className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-800 font-semibold">{t.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.sale ? formatYen(t.sale) : "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-600">{t.refund ? `− ${formatYen(Math.abs(t.refund))}` : "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{t.parent ? formatYen(t.parent) : "—"}</td>
                            <td className="px-3 py-2 text-right"><Signed v={t.net} /></td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{t.count}</td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => setOpenPartner(open ? null : t.partnerId)}
                                className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                                {open ? "閉じる" : "明細"}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-[#fafafa]">
                              <td colSpan={7} className="px-3 pb-3 pt-1">
                                <table className="w-full text-[11.5px]">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <th className="text-left font-semibold py-1">計上日</th>
                                      <th className="text-left font-semibold py-1">区分</th>
                                      <th className="text-left font-semibold py-1">対象</th>
                                      <th className="text-right font-semibold py-1">按分ベース</th>
                                      <th className="text-right font-semibold py-1">分配額</th>
                                      <th className="text-left font-semibold py-1 pl-3">備考</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((e) => (
                                      <tr key={e.uid} className="border-t border-gray-200">
                                        <td className="py-1 text-gray-600 whitespace-nowrap">{e.accrualDate}</td>
                                        <td className="py-1 whitespace-nowrap">
                                          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${e.kind === "sale"
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                            : "bg-red-50 text-red-700 border-red-200"}`}>
                                            {e.kind === "sale" ? "売上" : "返金"}
                                          </span>
                                          {e.tierKind === "parent" && (
                                            <span className="ml-1 text-[10px] font-bold text-indigo-600">紹介元</span>
                                          )}
                                        </td>
                                        <td className="py-1 text-gray-600 whitespace-nowrap">
                                          {e.sourceType === "payment" ? "決済" : "返金"} #{e.sourceId}
                                        </td>
                                        <td className="py-1 text-right tabular-nums text-gray-600">{formatYen(Math.abs(e.baseAmount))}</td>
                                        <td className="py-1 text-right"><Signed v={e.amount} /></td>
                                        <td className="py-1 pl-3 text-gray-500 max-w-[260px] truncate" title={e.note}>{e.note}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-700 bg-gray-50 font-bold">
                      <td className="px-3 py-2.5 text-gray-700">合計（{byPartner.length}名）</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">{formatYen(byPartner.reduce((s, t) => s + t.sale, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-red-600">− {formatYen(Math.abs(byPartner.reduce((s, t) => s + t.refund, 0)))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatYen(byPartner.reduce((s, t) => s + t.parent, 0))}</td>
                      <td className="px-3 py-2.5 text-right"><Signed v={totals.share} /></td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* 過去の確定 */}
          {periods.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-gray-700">確定の履歴</h2>
              <div className="flex flex-wrap gap-1.5">
                {periods.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPeriod(p.period)}
                    className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${p.period === period
                      ? "border-red-300 bg-red-50 text-red-700"
                      : p.status === "fixed"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {p.period}
                    <span className="ml-1.5 text-[10.5px] font-normal">
                      {p.status === "fixed" ? formatYen(p.totalShare) : "下書き"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* ══ 分配先とルール ══ */
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
          {/* 左：分配先とルールの一覧 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-700">分配先</h2>
              <div className="flex-1" />
              {canEditRules && (
                <button onClick={() => { setREdit(null); setPEdit(newPartner()); }} disabled={unavailable} className={btnMain}>
                  ＋ 分配先
                </button>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {partners.filter((p) => !p.isDeleted).length === 0 ? (
                <div className="text-center text-gray-300 py-10 text-sm">
                  {unavailable ? "マイグレーション適用後に利用できます。" : "分配先がありません。「＋ 分配先」から追加してください。"}
                </div>
              ) : partners.filter((p) => !p.isDeleted).map((p, i) => {
                const mine = rules.filter((r) => !r.isDeleted && r.partnerId === p.id);
                return (
                  <div key={p.id} className={`px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-800 truncate">{p.name}</div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {p.email || "—"}
                          {p.parentPartnerId != null && ` ・ 紹介元：${partnerName(p.parentPartnerId)}`}
                        </div>
                      </div>
                      {canEditRules && (
                        <>
                          <button onClick={() => { setPEdit(null); setREdit(newShareRule(p.id)); }}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">＋ルール</button>
                          <button onClick={() => { setREdit(null); setPEdit({ ...p }); }}
                            className="text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
                        </>
                      )}
                    </div>
                    {mine.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {mine.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-[11.5px] bg-[#fafafa] border border-gray-200 rounded-lg px-2.5 py-1.5">
                            <span className="text-gray-700">{describeRule(r, typeName(r.typeId))}</span>
                            <div className="flex-1" />
                            {canEditRules && (
                              <button onClick={() => { setPEdit(null); setREdit({ ...r }); }}
                                className="text-[11px] text-red-500 hover:text-red-700">編集</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {mine.length === 0 && (
                      <div className="mt-1.5 text-[11px] text-amber-700">
                        ルールが無いため、この分配先には分配されません。
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11.5px] text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 leading-relaxed">
              1つの売上に複数の分配先のルールが当たれば、<b>それぞれに分配されます</b>。
              同じ分配先で複数のルールが当たった場合は、<b>より具体的な1本だけ</b>を使います
              （商品種別の指定あり ＞ 全商品、初回／2回目以降の指定あり ＞ 両方、次に優先度）。
            </p>
          </div>

          {/* 右：編集パネル */}
          <div className="lg:sticky lg:top-4 self-start min-w-0">
            {pEdit && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="font-bold text-gray-800">{pEdit.id ? "分配先を編集" : "分配先を追加"}</h2>
                  <button onClick={() => setPEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">名称 <span className="text-red-500">*</span></label>
                    <input className={input} value={pEdit.name} onChange={(e) => setPEdit({ ...pEdit, name: e.target.value })} placeholder="株式会社◯◯ / 山田太郎" /></div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">メールアドレス</label>
                    <input className={input} value={pEdit.email} onChange={(e) => setPEdit({ ...pEdit, email: e.target.value })} placeholder="明細の送付先" /></div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">紹介元（2ティア報酬の受け取り先）</label>
                    <select className={`${input} bg-white`} value={pEdit.parentPartnerId ?? ""}
                      onChange={(e) => setPEdit({ ...pEdit, parentPartnerId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">（なし）</option>
                      {partners.filter((x) => !x.isDeleted && x.id !== pEdit.id).map((x) => (
                        <option key={x.id} value={x.id}>{x.name}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      ルールに「紹介元へ◯%」を設定すると、この相手にも同時に分配されます。
                    </p></div>
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                    <textarea className={`${input} min-h-[56px]`} value={pEdit.note} onChange={(e) => setPEdit({ ...pEdit, note: e.target.value })} /></div>
                  <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={pEdit.isDeleted} onChange={(e) => setPEdit({ ...pEdit, isDeleted: e.target.checked })}
                      className="w-4 h-4 accent-red-600" />
                    無効にする（過去の確定済みレポートはそのまま残ります）
                  </label>
                </div>
                <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
                  <div className="flex-1" />
                  <button onClick={() => setPEdit(null)} className={btnGhost}>キャンセル</button>
                  <SaveButton onSave={doSavePartner} />
                </div>
              </div>
            )}

            {rEdit && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="font-bold text-gray-800">{rEdit.id ? "分配ルールを編集" : "分配ルールを追加"}</h2>
                  <button onClick={() => setREdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div><label className="text-xs font-bold text-gray-500 block mb-1">分配先 <span className="text-red-500">*</span></label>
                    <select className={`${input} bg-white`} value={rEdit.partnerId || ""}
                      onChange={(e) => setREdit({ ...rEdit, partnerId: Number(e.target.value) || 0 })}>
                      <option value="">（未選択）</option>
                      {partners.filter((p) => !p.isDeleted).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">対象</label>
                      <select className={`${input} bg-white`} value={rEdit.scope}
                        onChange={(e) => setREdit({ ...rEdit, scope: e.target.value as ShareRule["scope"] })}>
                        <option value="all">全商品</option>
                        <option value="type">商品種別を指定</option>
                      </select></div>
                    {rEdit.scope === "type" && (
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">商品種別 <span className="text-red-500">*</span></label>
                        <select className={`${input} bg-white`} value={rEdit.typeId ?? ""}
                          onChange={(e) => setREdit({ ...rEdit, typeId: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">（未選択）</option>
                          {types.filter((t) => !t.isDeleted).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select></div>
                    )}
                  </div>

                  <div><label className="text-xs font-bold text-gray-500 block mb-1">購入回数</label>
                    <select className={`${input} bg-white`} value={rEdit.tier}
                      onChange={(e) => setREdit({ ...rEdit, tier: e.target.value as ShareRule["tier"] })}>
                      {(["both", "first", "repeat"] as const).map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      同じ顧客・同じ商品種別で最初の決済かどうかで判定します（全期間の履歴で見ます）。
                    </p></div>

                  <div className="rounded-xl border border-gray-200 bg-[#fafafa] p-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">計算方法</label>
                        <select className={`${input} bg-white`} value={rEdit.calc}
                          onChange={(e) => setREdit({ ...rEdit, calc: e.target.value as ShareRule["calc"] })}>
                          <option value="rate">率（％）</option>
                          <option value="fixed">固定額（円）</option>
                        </select></div>
                      {rEdit.calc === "rate" ? (
                        <div><label className="text-xs font-bold text-gray-500 block mb-1">分配率（％） <span className="text-red-500">*</span></label>
                          <input type="number" inputMode="decimal" step="0.1" className={`${input} bg-white`} value={rEdit.rate || ""}
                            onChange={(e) => setREdit({ ...rEdit, rate: Math.max(0, Number(e.target.value) || 0) })} placeholder="30" /></div>
                      ) : (
                        <div><label className="text-xs font-bold text-gray-500 block mb-1">固定額（円） <span className="text-red-500">*</span></label>
                          <input type="number" inputMode="numeric" className={`${input} bg-white`} value={rEdit.fixedAmount || ""}
                            onChange={(e) => setREdit({ ...rEdit, fixedAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="10000" /></div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">紹介元へ（％）</label>
                        <input type="number" inputMode="decimal" step="0.1" className={`${input} bg-white`} value={rEdit.parentRate || ""}
                          onChange={(e) => setREdit({ ...rEdit, parentRate: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" />
                        <p className="text-[11px] text-gray-400 mt-1">分配先に紹介元が設定されている場合のみ効きます。</p></div>
                      <div><label className="text-xs font-bold text-gray-500 block mb-1">端数処理</label>
                        <select className={`${input} bg-white`} value={rEdit.rounding}
                          onChange={(e) => setREdit({ ...rEdit, rounding: e.target.value as ShareRule["rounding"] })}>
                          <option value="floor">切り捨て（推奨）</option>
                          <option value="round">四捨五入</option>
                          <option value="ceil">切り上げ</option>
                        </select></div>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      按分ベースは<b>計上額（総額 − 決済手数料）</b>です。
                      {rEdit.calc === "rate" && rEdit.rate > 0 && (
                        <> 例：計上額 159,060円 → <b>{formatYen(Math.floor(159060 * (rEdit.rate / 100)))}</b></>
                      )}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">適用開始</label>
                      <input type="date" className={input} value={rEdit.validFrom}
                        onChange={(e) => setREdit({ ...rEdit, validFrom: e.target.value })} /></div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">適用終了</label>
                      <input type="date" className={input} value={rEdit.validTo}
                        onChange={(e) => setREdit({ ...rEdit, validTo: e.target.value })} /></div>
                    <div><label className="text-xs font-bold text-gray-500 block mb-1">優先度</label>
                      <input type="number" inputMode="numeric" className={input} value={rEdit.priority || ""}
                        onChange={(e) => setREdit({ ...rEdit, priority: Math.floor(Number(e.target.value) || 0) })} placeholder="0" /></div>
                  </div>

                  <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                    <input className={input} value={rEdit.note} onChange={(e) => setREdit({ ...rEdit, note: e.target.value })} placeholder="契約書 §3 の条件 など" /></div>

                  <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={rEdit.isDeleted} onChange={(e) => setREdit({ ...rEdit, isDeleted: e.target.checked })}
                      className="w-4 h-4 accent-red-600" />
                    無効にする
                  </label>
                </div>
                <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
                  <div className="flex-1" />
                  <button onClick={() => setREdit(null)} className={btnGhost}>キャンセル</button>
                  <SaveButton onSave={doSaveRule} />
                </div>
              </div>
            )}

            {!pEdit && !rEdit && (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl px-5 py-10 text-center">
                <div className="text-[12.5px] text-gray-500">左から分配先またはルールを選ぶと、ここで編集できます。</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
