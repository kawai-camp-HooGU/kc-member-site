"use client";
// ============================================================
// 入出金の登録 ＋ 消込モーダル（設計書 §5-3）
//
//   通帳の1行（着金・送金）をそのまま登録し、売上経費の明細に消し込む。
//
//   ＜この画面がやらないこと＞
//   ・振込手数料を明細に按分しない。差額は「調整」として**この入出金に1行**だけ持つ。
//     明細（売上・経費）の計上額は消込によって1円も動かない。これが設計の要。
//
//   ＜差額の扱い＞
//     差額 ＝ 充当額の合計 − 実着金額
//       正（＋）… 引かれて着金した（振込手数料など。よくある）
//       負（−）… 多く着金した（過入金。人が原因を確認する）
//     許容枠（±1,000円）内なら「振込手数料」として自動で区分し、
//     超えていたら操作者に確認させてから保存する。
//
//   ＜まだ消し込まない場合＞
//     消込0件のまま保存できる。通帳を先に登録し、あとで消し込む運用を許すため。
//     この状態では差額の判定をしない（全額が差額に見えてしまうため）。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "../common/Sheet";
import { useToast } from "../common/ToastProvider";
import { useConfirm } from "../common/ConfirmProvider";
import { SaveButton } from "../common/SaveButton";
import { formatYen } from "../../lib/payments";
import {
  ADJUSTMENT_LABEL, DEFAULT_TOLERANCE, allocKey, autoMatchByExternalId, buildCandidates,
  calcDiff, deleteCashEntry, remainOf, saveCashEntry, suggestAdjustment, suggestByAmount,
  type AllocCandidate,
} from "../../lib/cash";
import type {
  AdjustmentKind, CashAllocation, CashEntry, Expense, Payment, PaymentMaster,
} from "../../lib/models";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

const ADJ_KINDS: AdjustmentKind[] = ["transfer_fee", "fee_diff", "withholding", "fx", "unknown"];

export interface CashEntryModalProps {
  open: boolean;
  /** 編集対象。新規は newCashEntry() を渡す */
  value: CashEntry | null;
  sites: PaymentMaster[];
  payments: Payment[];
  expenses: Expense[];
  /** 保存済みの入出金すべて。編集中の1件を除いて「他で消込済みの額」を求める */
  entries: CashEntry[];
  onClose: () => void;
  onSaved: () => void;
}

export function CashEntryModal({
  open, value, sites, payments, expenses, entries, onClose, onSaved,
}: CashEntryModalProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [d, setD] = useState<CashEntry | null>(value);
  const [kw, setKw] = useState("");
  const [txnPaste, setTxnPaste] = useState("");
  const [adjKind, setAdjKind] = useState<AdjustmentKind>("transfer_fee");
  const [adjMemo, setAdjMemo] = useState("");
  /** 許容枠を超える差額は、操作者が明示的に認めるまで保存させない */
  const [ackDiff, setAckDiff] = useState(false);

  // 開くたびに読み込み直す（前回の下書きを持ち越さない）
  useEffect(() => {
    if (!open) return;
    setD(value ? { ...value, allocations: [...value.allocations] } : null);
    setKw(""); setTxnPaste(""); setAckDiff(false);
    const a = value?.adjustments?.[0];
    setAdjKind(a?.kind ?? "transfer_fee");
    setAdjMemo(a?.memo ?? "");
  }, [open, value]);

  const set = (patch: Partial<CashEntry>) => d && setD({ ...d, ...patch });

  // ── 他の入出金による消込済み額（編集中の1件は除く）──
  //   これを除かないと、編集で開き直すたびに自分の消込分だけ残額が減っていく。
  const settledElsewhere = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (d && e.id && e.id === d.id) continue;
      for (const a of e.allocations) {
        const k = allocKey(a.sourceType, a.sourceId);
        m.set(k, (m.get(k) ?? 0) + (Math.round(a.amount) || 0));
      }
    }
    return m;
  }, [entries, d?.id]);

  const candidates = useMemo(
    () => (d ? buildCandidates(d.direction, payments, expenses, settledElsewhere) : []),
    [d?.direction, payments, expenses, settledElsewhere],
  );

  /** 充当中の額（sourceType:sourceId → 円） */
  const allocMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of d?.allocations ?? []) m.set(allocKey(a.sourceType, a.sourceId), a.amount);
    return m;
  }, [d?.allocations]);

  /** 一覧に出す候補。消込済みの相手も、選択中なら残す（消せるように） */
  const shownCandidates = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return candidates
      .filter((c) => remainOf(c) > 0 || allocMap.has(allocKey(c.sourceType, c.sourceId)))
      .filter((c) => !k || [c.label, c.externalTxnId, c.accrualDate, c.expectedDate].some((s) => (s ?? "").toLowerCase().includes(k)))
      .sort((a, b) => {
        const da = a.expectedDate || a.accrualDate, db = b.expectedDate || b.accrualDate;
        if (da !== db) return da < db ? -1 : 1;
        return a.sourceId - b.sourceId;
      });
  }, [candidates, kw, allocMap]);

  const setAllocs = (list: CashAllocation[]) => d && setD({ ...d, allocations: list });

  const toggle = (c: AllocCandidate) => {
    if (!d) return;
    const k = allocKey(c.sourceType, c.sourceId);
    if (allocMap.has(k)) {
      setAllocs(d.allocations.filter((a) => allocKey(a.sourceType, a.sourceId) !== k));
    } else {
      setAllocs([...d.allocations, { id: 0, cashEntryId: d.id, sourceType: c.sourceType, sourceId: c.sourceId, amount: remainOf(c) }]);
    }
  };

  /** 充当額を手で変える（残額を超えさせない） */
  const setAllocAmount = (c: AllocCandidate, v: number) => {
    if (!d) return;
    const k = allocKey(c.sourceType, c.sourceId);
    const amount = Math.min(Math.max(0, Math.floor(v) || 0), remainOf(c));
    setAllocs(d.allocations.map((a) => (allocKey(a.sourceType, a.sourceId) === k ? { ...a, amount } : a)));
  };

  /** 候補の集合をそのまま消込に置き換える（自動消込の共通処理） */
  const applyPicked = (picked: AllocCandidate[], label: string) => {
    if (!d) return;
    if (!picked.length) { toast.error(`${label}：一致する明細がありませんでした`); return; }
    setAllocs(picked.map((c) => ({
      id: 0, cashEntryId: d.id, sourceType: c.sourceType, sourceId: c.sourceId, amount: remainOf(c),
    })));
    toast.success(`${label}：${picked.length}件を消し込みました`);
  };

  const doAutoById = () => {
    // 改行・カンマ・空白・タブのどれで区切って貼られても拾う
    const ids = txnPaste.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) { toast.error("決済ID（外部取引ID）を貼り付けてください"); return; }
    applyPicked(autoMatchByExternalId(candidates, ids), "外部IDで消込");
  };

  const doAutoByAmount = () => {
    if (!d?.amount) { toast.error("実着金額を入力してください"); return; }
    applyPicked(suggestByAmount(candidates, d.amount), "金額から提案");
  };

  // ── 差額 ─────────────────────────────────────────────────
  const hasAlloc = (d?.allocations.length ?? 0) > 0;
  const allocated = useMemo(
    () => (d?.allocations ?? []).reduce((s, a) => s + (Math.round(a.amount) || 0), 0),
    [d?.allocations],
  );
  // 消込0件のうちは差額を判定しない（全額が差額に見えてしまうため）
  const diff = hasAlloc && d ? calcDiff(d.amount, d.allocations) : 0;

  const siteCfg = useMemo(() => {
    const s = d?.siteId != null ? sites.find((x) => x.id === d.siteId) : undefined;
    return s?.site ? { transferFee: s.site.transferFee } : null;
  }, [d?.siteId, sites]);

  const sug = useMemo(() => suggestAdjustment(diff, siteCfg, DEFAULT_TOLERANCE), [diff, siteCfg]);

  // 差額が変わったら区分の初期値も追従させる（操作者が選び直せば上書きされる）
  useEffect(() => {
    if (sug.adjustment) setAdjKind(sug.adjustment.kind);
  }, [sug.adjustment?.kind]);

  const needsAck = diff !== 0 && !sug.auto;
  const dirLabel = d?.direction === "out" ? "出金" : "入金";

  const doSave = async () => {
    if (!d) return;
    if (!d.entryDate) { toast.error("入出金日を入力してください"); return; }
    if (!d.amount || d.amount <= 0) { toast.error(`実${dirLabel}額を入力してください`); return; }
    if (needsAck && !ackDiff) { toast.error("差額の内容を確認してチェックを入れてください"); return; }

    // 「充当額 − 調整 ＝ 実着金額」が必ず成り立つよう、調整は差額そのものを1行で持たせる
    const adjustments = diff === 0 ? [] : [{ kind: adjKind, amount: diff, memo: adjMemo }];
    const res = await saveCashEntry({ ...d, adjustments });
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    toast.success("保存しました");
    onSaved(); onClose();
  };

  const doDelete = async () => {
    if (!d?.id) return;
    if (!(await confirm({
      title: `${dirLabel}を削除`,
      message: "この入出金と、ひも付く消込をすべて取り消します。明細の計上額は変わりません。",
      confirmLabel: "削除する", danger: true,
    }))) return;
    await deleteCashEntry(d.id);
    toast.success("削除しました");
    onSaved(); onClose();
  };

  if (!d) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={d.id ? `${dirLabel}を編集` : `${dirLabel}を登録`}
      maxWidth={900}
      footer={
        <div className="flex items-center gap-2 w-full">
          {d.id ? (
            <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
              削除
            </button>
          ) : null}
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            キャンセル
          </button>
          <SaveButton onSave={doSave} />
        </div>
      }
    >
      <div className="space-y-4">
        {/* ── 通帳の1行 ── */}
        <div className="rounded-xl border border-gray-200 bg-[#fafafa] p-3 space-y-2.5">
          <div className="text-[11px] font-bold text-gray-500">通帳の1行をそのまま入れます</div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">区分</label>
              <div className="flex gap-1.5">
                {(["in", "out"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setD({ ...d, direction: v, allocations: [] })}
                    className={`flex-1 px-2 py-2 rounded-lg border text-[12px] font-semibold ${d.direction === v
                      ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {v === "in" ? "入金" : "出金"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">入出金日 <span className="text-red-500">*</span></label>
              <input type="date" className={`${input} bg-white`} value={d.entryDate}
                onChange={(e) => set({ entryDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">経路（サイト）</label>
              <select className={`${input} bg-white`} value={d.siteId ?? ""}
                onChange={(e) => set({ siteId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">（未選択）</option>
                {sites.filter((s) => !s.isDeleted).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">実{dirLabel}額（円） <span className="text-red-500">*</span></label>
              <input type="number" inputMode="numeric" className={`${input} bg-white font-bold`} value={d.amount || ""}
                onChange={(e) => set({ amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="328410" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">口座</label>
              <input className={`${input} bg-white`} value={d.accountName}
                onChange={(e) => set({ accountName: e.target.value })} placeholder="三菱UFJ 普通" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">摘要</label>
              <input className={`${input} bg-white`} value={d.description}
                onChange={(e) => set({ description: e.target.value })} placeholder="ストライプジヤパン（カ" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">入金ID <span className="text-gray-400 font-normal">任意</span></label>
              <input className={`${input} bg-white font-mono text-[12.5px]`} value={d.externalPayoutId}
                onChange={(e) => set({ externalPayoutId: e.target.value.trim() })} placeholder="po_1AbC…" />
            </div>
          </div>
        </div>

        {/* ── 自動消込 ── */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2.5">
          <div className="text-[11px] font-bold text-indigo-800">自動で消し込む</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-end">
            <div>
              <label className="text-[11px] text-indigo-800 block mb-1">決済ID（外部取引ID）を貼り付け</label>
              <textarea className={`${input} bg-white font-mono text-[12px] min-h-[56px]`} value={txnPaste}
                onChange={(e) => setTxnPaste(e.target.value)} placeholder="ch_1AbC…&#10;ch_2DeF…" />
            </div>
            <button type="button" onClick={doAutoById}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 whitespace-nowrap">
              外部IDで消込
            </button>
          </div>
          <p className="text-[11px] text-indigo-700 leading-relaxed">
            決済サイトのバッチ入金は通帳に名義も金額も一致しない形で出るため、決済IDで確定一致させます（誤検知が起きません）。
          </p>
          <div className="flex items-center gap-2 pt-1 border-t border-indigo-200">
            <button type="button" onClick={doAutoByAmount}
              className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-indigo-700 text-[12px] font-semibold hover:bg-indigo-50">
              金額から提案
            </button>
            <span className="text-[11px] text-indigo-700">
              予定日の古い順に積み上げる下書きです。<b>総当たりではないため、必ず目で確認してください。</b>
            </span>
          </div>
        </div>

        {/* ── 消込の相手 ── */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-xs font-bold text-gray-500">
              消込の相手（{d.direction === "in" ? "売上" : "経費"}）
            </label>
            <span className="text-[11px] text-gray-400">{d.allocations.length}件 選択中</span>
            <div className="flex-1" />
            {hasAlloc && (
              <button type="button" onClick={() => setAllocs([])} className="text-[11px] text-gray-500 hover:text-gray-700 underline">
                選択をクリア
              </button>
            )}
          </div>
          <input className={`${input} mb-2`} value={kw} onChange={(e) => setKw(e.target.value)}
            placeholder="取引先・顧客・決済IDで絞り込み" />

          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[280px] overflow-y-auto">
            {shownCandidates.length === 0 ? (
              <div className="text-center text-gray-300 py-8 text-[12.5px]">
                消し込める{d.direction === "in" ? "売上" : "経費"}がありません。
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0">
                  <tr className="bg-gray-700 text-gray-100">
                    <th className="w-8" />
                    <th className="text-left font-bold px-2 py-1.5 whitespace-nowrap">予定日</th>
                    <th className="text-left font-bold px-2 py-1.5">取引先・顧客</th>
                    <th className="text-left font-bold px-2 py-1.5 whitespace-nowrap">決済ID</th>
                    <th className="text-right font-bold px-2 py-1.5 whitespace-nowrap">残額</th>
                    <th className="text-right font-bold px-2 py-1.5 whitespace-nowrap">充当額</th>
                  </tr>
                </thead>
                <tbody>
                  {shownCandidates.map((c) => {
                    const k = allocKey(c.sourceType, c.sourceId);
                    const on = allocMap.has(k);
                    const partial = c.settled > 0;
                    return (
                      <tr key={k} className={`border-t border-gray-100 ${on ? "bg-emerald-50" : "hover:bg-gray-50"}`}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={on} onChange={() => toggle(c)} className="w-4 h-4 accent-emerald-600" />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{c.expectedDate || c.accrualDate || "—"}</td>
                        <td className="px-2 py-1.5 text-gray-800 font-semibold max-w-[180px] truncate" title={c.label}>
                          {c.label}
                          {partial && <span className="ml-1 text-[10px] font-bold text-amber-600">一部消込済</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-gray-400 max-w-[120px] truncate" title={c.externalTxnId}>
                          {c.externalTxnId || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatYen(remainOf(c))}</td>
                        <td className="px-2 py-1.5 text-right">
                          {on ? (
                            <input type="number" inputMode="numeric" value={allocMap.get(k) || ""}
                              onChange={(e) => setAllocAmount(c, Number(e.target.value))}
                              className="w-[110px] border border-emerald-300 bg-white rounded-lg px-2 py-1 text-[12px] text-right tabular-nums font-semibold text-emerald-900 focus:outline-none focus:border-emerald-500" />
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── 検算と差額 ── */}
        <div className="rounded-xl border border-gray-300 p-3 space-y-2.5">
          <div className="text-[11px] font-bold text-gray-500">検算</div>

          {!hasAlloc ? (
            <p className="text-[12px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
              まだ消し込んでいません。このまま保存して、あとから消し込むこともできます
              （通帳を先に登録する運用）。
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="bg-[#faf9f7] rounded-lg px-3 py-2">
                  <div className="text-[10.5px] text-gray-500">充当額の合計</div>
                  <div className="text-base font-bold text-gray-800 tabular-nums">{formatYen(allocated)}</div>
                </div>
                <div className="bg-[#faf9f7] rounded-lg px-3 py-2">
                  <div className="text-[10.5px] text-gray-500">実{dirLabel}額</div>
                  <div className="text-base font-bold text-gray-800 tabular-nums">{formatYen(d.amount)}</div>
                </div>
                <div className={`rounded-lg px-3 py-2 ${diff === 0 ? "bg-emerald-50" : sug.auto ? "bg-amber-50" : "bg-red-50"}`}>
                  <div className="text-[10.5px] text-gray-500">差額</div>
                  <div className={`text-base font-bold tabular-nums ${diff === 0 ? "text-emerald-700" : sug.auto ? "text-amber-700" : "text-red-700"}`}>
                    {diff === 0 ? "0" : `${diff > 0 ? "−" : "＋"}${formatYen(Math.abs(diff))}`}
                  </div>
                </div>
              </div>

              <p className={`text-[11.5px] leading-relaxed ${diff === 0 ? "text-emerald-700" : sug.auto ? "text-amber-800" : "text-red-700"}`}>
                {diff === 0
                  ? "差額はありません。充当額と実着金額が一致しています。"
                  : diff > 0
                    ? `充当額より ${formatYen(Math.abs(diff))} 少なく着金しています。${sug.reason}`
                    : `充当額より ${formatYen(Math.abs(diff))} 多く着金しています。${sug.reason}`}
              </p>

              {diff !== 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2.5">
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">差額の区分</label>
                      <select className={`${input} bg-white`} value={adjKind}
                        onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}>
                        {ADJ_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_LABEL[k]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">メモ</label>
                      <input className={input} value={adjMemo} onChange={(e) => setAdjMemo(e.target.value)}
                        placeholder="振込手数料 250円 など" />
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
                    この差額は<b>明細に按分しません</b>。この{dirLabel} 1件につき「{ADJUSTMENT_LABEL[adjKind]}」1行として持ちます。
                    売上・経費の計上額は消込によって変わりません。
                  </p>

                  {needsAck && (
                    <label className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 cursor-pointer">
                      <input type="checkbox" checked={ackDiff} onChange={(e) => setAckDiff(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-red-600" />
                      <span>
                        差額が許容枠（±{DEFAULT_TOLERANCE.toLocaleString("ja-JP")}円）の外です。内容を確認しました。
                        <span className="block text-[11px] text-red-600 mt-0.5">
                          消込の選び間違い・金額の入力ミスが無いか、先に見直してください。
                        </span>
                      </span>
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
