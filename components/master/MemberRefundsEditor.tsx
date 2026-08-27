"use client";
// ============================================================
// 返金・解約（メンバー詳細画面のカード・編集可能）
//
//   BEFORE：表示専用のカード。登録・進捗更新は /ops/refunds の専用画面で行っていた。
//           返金は「誰の返金か」が常に主語なのに、会員を探し直す往復が要った。
//   AFTER ：この場で複数件を追加・編集し、まとめて保存する（REQ-036）。
//
//   ＜行の見せ方＞
//     既定は要約1行、クリックで詳細を開く（brand.md §2-4「消すのではなく畳む」）。
//     新規行は開いた状態で挿入し、受付日時に現在時刻を入れておく。
//
//   ＜保存＞
//     会員の基本情報とは保存単位を分ける（確認事項1a）。返金だけ直したいときに
//     氏名や属性まで保存されないようにするため、カード内に専用の保存ボタンを持つ。
//     変更のあった行だけを送り、1行落ちても残りは保存する。
//
//   ＜経費・出金＞
//     完了扱いのステータス＋返金完了日時が揃うと、保存時に経費行が生成される
//     （lib/refunds.ts の syncRefundExpense）。出金の消込はその経費行に対して行う。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchMemberRefunds, saveRefunds, deleteRefund, formatYen,
  fetchRefundMasterOptions, fetchRefundMasterGroups, refundMasterName, doneStatusIds,
  newRefundFor, refundExpectedDate, fetchRefundSettlement,
  type RefundSettlement,
} from "../../lib/refunds";
import { fetchExpenseCategories, expensesAvailable } from "../../lib/expenses";
import { fetchMasterOptions } from "../../lib/payments";
import type {
  Refund, RefundMaster, RefundMasterGroup, RefundKind, ExpenseCategory, PaymentMaster,
} from "../../lib/models";
import { errMessage } from "../../lib/errors";
import { FIELD_INPUT } from "../../lib/constants";
import { useToast } from "../common/ToastProvider";
import { useConfirm } from "../common/ConfirmProvider";
import { Icon } from "../common/Icon";

const input = FIELD_INPUT;
const label = "block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1";

const KIND_LABEL: Record<RefundKind, string> = { refund: "返金", cancel: "解約", both: "返金＋解約" };
const KINDS: RefundKind[] = ["refund", "cancel", "both"];

/** 一覧の日付表示。"2026-08-22T10:30" → "08-22" */
const shortDate = (s: string) => (s ? s.slice(5, 10) : "--/--");

/** 行の識別キー。保存済みは id、未保存はローカル採番（React の key と開閉状態に使う） */
type Row = Refund & { _key: string };

export function MemberRefundsEditor({
  memberId, memberName = "", memberEmail = "", canEdit = true,
}: {
  memberId: number;
  memberName?: string;
  memberEmail?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<Row[]>([]);
  /** 読み込み直後の内容。変更のあった行だけを保存するための基準 */
  const [baseline, setBaseline] = useState<Map<string, string>>(new Map());
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  const [cat1, setCat1] = useState<RefundMaster[]>([]);
  const [cat2, setCat2] = useState<RefundMaster[]>([]);
  const [statuses, setStatuses] = useState<RefundMaster[]>([]);
  const [groups, setGroups] = useState<RefundMasterGroup[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);
  const [methods, setMethods] = useState<PaymentMaster[]>([]);
  const [settle, setSettle] = useState<Map<number, RefundSettlement>>(new Map());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tmpSeq, setTmpSeq] = useState(0);
  /** 部分失敗・入力不備の赤帯。取得できた分は消さずに上に1本だけ出す */
  const [alert, setAlert] = useState("");

  const groupLabel = (key: string, fallback: string) => groups.find((g) => g.key === key)?.label || fallback;
  const doneIds = useMemo(() => doneStatusIds(statuses), [statuses]);
  const isDone = useCallback((id: number | null) => id != null && doneIds.has(id), [doneIds]);

  const snapshot = (r: Refund) => JSON.stringify({ ...r, id: undefined });

  const load = useCallback(async () => {
    try {
      const [rs, opts, gs] = await Promise.all([
        fetchMemberRefunds(memberId), fetchRefundMasterOptions(), fetchRefundMasterGroups(),
      ]);
      const withKey: Row[] = rs.map((r) => ({ ...r, _key: `id:${r.id}` }));
      setRows(withKey);
      setBaseline(new Map(withKey.map((r) => [r._key, snapshot(r)])));
      setCat1(opts.cancel_cat1); setCat2(opts.cancel_cat2); setStatuses(opts.refund_status);
      setGroups(gs);
      // 消込の状況は返金が1件も無ければ引かない（無駄な往復を作らない）
      if (rs.length > 0) setSettle(await fetchRefundSettlement(rs.map((r) => r.id)));
    } catch (e) {
      // 権限・未マイグレーション時は空表示。ここで画面を落とさない
      console.error("返金・解約の読込エラー:", e);
    }
    // 経費科目・出金経路は「あれば使う」。無ければ該当の入力欄を出さない
    try {
      const [cs, m] = await Promise.all([fetchExpenseCategories(), fetchMasterOptions()]);
      setCategories(cs); setSites(m.sites); setMethods(m.methods);
    } catch { /* 経費テーブル未作成。返金の入力自体は使える */ }
    setLoading(false);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // ── 行の操作 ────────────────────────────────────────────────
  const patch = (key: string, v: Partial<Refund>) =>
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...v } : r)));

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const addRow = () => {
    const key = `tmp:${tmpSeq}`;
    setTmpSeq((n) => n + 1);
    setRows((prev) => [...prev, { ...newRefundFor(memberId, memberName, memberEmail), _key: key }]);
    setOpenKeys((prev) => new Set(prev).add(key));
    setAlert("");
  };

  const removeRow = async (row: Row) => {
    const s = settle.get(row.id);
    if (s && s.settled > 0) {
      toast.error(`この返金には ${formatYen(s.settled)} の消込があります。先に入出金側で消込を外してください。`);
      return;
    }
    const ok = await confirm({
      title: "返金・解約を削除",
      message: row.id ? "この返金・解約を削除しますか？生成済みの経費行も取り消されます。" : "この行を削除しますか？",
      confirmLabel: "削除する", danger: true,
    });
    if (!ok) return;
    if (row.id) {
      try { await deleteRefund(row.id); }
      catch (e) { toast.error(errMessage(e, "削除に失敗しました")); return; }
    }
    setRows((prev) => prev.filter((r) => r._key !== row._key));
    setSettle((prev) => { const n = new Map(prev); n.delete(row.id); return n; });
    toast.success("削除しました");
  };

  // ── 保存 ────────────────────────────────────────────────────
  const dirtyKeys = useMemo(
    () => rows.filter((r) => baseline.get(r._key) !== snapshot(r)).map((r) => r._key),
    [rows, baseline],
  );

  const validate = (): string => {
    const bad: string[] = [];
    rows.forEach((r, i) => {
      if (!r.requestedAt) bad.push(`${i + 1}行目：受付日時が未入力です`);
      else if (isDone(r.statusId) && !r.refundedAt) bad.push(`${i + 1}行目：完了扱いのステータスでは返金完了日時が必要です`);
    });
    return bad.join(" ／ ");
  };

  const doSave = async () => {
    const ng = validate();
    if (ng) {
      setAlert(ng);
      setOpenKeys(new Set(rows.map((r) => r._key)));   // 直すべき行を隠さない
      return;
    }
    const targets = rows.filter((r) => dirtyKeys.includes(r._key));
    if (targets.length === 0) { toast.success("変更はありません"); return; }

    // 消込済みの返金で金額を下げると、充当額が計上額を超えて帳簿が合わなくなる
    for (const r of targets) {
      const s = settle.get(r.id);
      if (s && s.settled > r.refundAmount) {
        const ok = await confirm({
          title: "消込済みの返金です",
          message: `この返金には ${formatYen(s.settled)} の消込があります。金額を ${formatYen(r.refundAmount)} に下げると消込が過剰になります。続けますか？`,
          confirmLabel: "このまま保存", danger: true,
        });
        if (!ok) return;
      }
    }

    setSaving(true);
    setAlert("");
    try {
      const { failed } = await saveRefunds(targets);
      if (failed.length > 0) {
        setAlert(`${failed.length}件の保存に失敗しました：${failed.map((f) => f.error).join(" / ")}`);
        toast.error("一部の行を保存できませんでした");
      } else {
        toast.success(`${targets.length}件を保存しました`);
      }
      await load();
    } catch (e) {
      setAlert(errMessage(e, "保存に失敗しました"));
    }
    setSaving(false);
  };

  // ── 集計 ────────────────────────────────────────────────────
  const bookedTotal = useMemo(
    () => rows.reduce((s, r) => s + (isDone(r.statusId) && r.refundedAt ? (r.refundAmount || 0) : 0), 0),
    [rows, isDone],
  );
  const unsettled = useMemo(() => rows.reduce((s, r) => {
    if (!isDone(r.statusId) || !r.refundedAt) return s;
    const st = settle.get(r.id);
    if (!st || !st.expenseId) return s;                  // 経費行がまだ無い＝従来どおり完了扱い
    return s + Math.max(0, (r.refundAmount || 0) - st.settled);
  }, 0), [rows, settle, isDone]);

  /** 消込バッジ。経費行がまだ無い行は「—」（従来どおり完了扱い） */
  const settleBadge = (r: Row) => {
    if (!isDone(r.statusId) || !r.refundedAt) {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">対象外</span>;
    }
    const st = settle.get(r.id);
    if (!st || !st.expenseId) {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">計上済</span>;
    }
    if (st.settled <= 0) {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">未消込</span>;
    }
    if (st.settled >= (r.refundAmount || 0)) {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">消込済</span>;
    }
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">一部</span>;
  };

  const statusBadge = (id: number | null) => {
    const cls = id == null ? "bg-gray-100 text-gray-400 border-gray-200"
      : isDone(id) ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-blue-50 text-blue-600 border-blue-100";
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{id == null ? "未選択" : refundMasterName(statuses, id)}</span>;
  };

  const anyOpen = openKeys.size > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      {/* ── ヘッダ ── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm flex items-center gap-1.5"><Icon name="doc" size={14} />返金・解約</span>
        <span className="text-[11px] text-gray-400">{canEdit ? "この会員の記録・複数件を登録できます" : "このメンバーの記録"}</span>
        <div className="flex-1" />
        {rows.length > 0 && (
          <button onClick={() => setOpenKeys(anyOpen ? new Set() : new Set(rows.map((r) => r._key)))}
            className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">
            {anyOpen ? "すべて畳む" : "すべて開く"}
          </button>
        )}
        <button onClick={() => router.push("/ops/ledger?kinds=refund&period=last12m")}
          className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">
          売上経費一覧で開く ↗
        </button>
        {canEdit && (
          <button onClick={doSave} disabled={saving}
            className="text-[11.5px] font-bold text-white bg-red-600 rounded-lg px-3 py-1 hover:bg-red-700 disabled:opacity-50">
            {saving ? "保存中…" : dirtyKeys.length > 0 ? `まとめて保存（${dirtyKeys.length}）` : "まとめて保存"}
          </button>
        )}
      </div>

      {alert && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-[12px] font-bold text-red-700">{alert}</div>
      )}

      {/* ── 行 ── */}
      {loading ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-gray-300">この会員に返金・解約はありません。</div>
      ) : rows.map((r, i) => {
        const open = openKeys.has(r._key);
        const dirty = dirtyKeys.includes(r._key);
        return (
          <div key={r._key} className={i > 0 ? "border-t border-gray-100" : ""}>
            {/* 要約行 */}
            <button onClick={() => toggle(r._key)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 ${open ? "bg-gray-50" : ""}`}>
              <span className="w-[46px] shrink-0 text-[11px] text-gray-400 tabular-nums">{shortDate(r.requestedAt)}</span>
              <span className="w-[62px] shrink-0 text-[11.5px] font-semibold text-gray-600">{KIND_LABEL[r.kind]}</span>
              <span className="w-[86px] shrink-0 text-[12.5px] font-bold text-gray-800 text-right tabular-nums">{formatYen(r.refundAmount)}</span>
              <span className="flex-1 min-w-0 text-[11px] text-gray-400 truncate">
                {refundMasterName(cat1, r.cancelCat1Id)}
                {r.expenseCategoryId != null && ` ／ ${categories.find((c) => c.id === r.expenseCategoryId)?.name ?? "—"}`}
              </span>
              {dirty && <span className="shrink-0 text-[10px] font-bold text-amber-700">未保存</span>}
              <span className="shrink-0">{statusBadge(r.statusId)}</span>
              <span className="shrink-0">{settleBadge(r)}</span>
              <span className="shrink-0 text-gray-300 text-[11px] w-3 text-center">{open ? "▴" : "▾"}</span>
            </button>

            {/* 詳細 */}
            {open && (
              <div className="px-4 py-4 bg-[#fbfbfc] border-t border-gray-100 space-y-4">
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                  <div>
                    <span className={label}>区分</span>
                    <div className="flex gap-1.5">
                      {KINDS.map((k) => (
                        <button key={k} disabled={!canEdit} onClick={() => patch(r._key, { kind: k })}
                          className={`flex-1 text-[11px] font-bold rounded-lg px-1 py-1.5 border ${r.kind === k ? "border-red-300 bg-red-50 text-red-600" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={label}>受付日時 <span className="text-red-500">*</span></label>
                    <input type="datetime-local" disabled={!canEdit} className={input} value={r.requestedAt}
                      onChange={(e) => patch(r._key, { requestedAt: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>返金金額（円）</label>
                    <input type="number" inputMode="numeric" disabled={!canEdit} className={input} value={r.refundAmount || ""}
                      placeholder="30000"
                      onChange={(e) => patch(r._key, { refundAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </div>
                  <div>
                    <label className={label}>{groupLabel("cancel_cat1", "解約希望理由")}</label>
                    <select disabled={!canEdit} className={`${input} bg-white`} value={r.cancelCat1Id ?? ""}
                      onChange={(e) => patch(r._key, { cancelCat1Id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">（未選択）</option>
                      {cat1.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>{groupLabel("cancel_cat2", "解約区分②")}</label>
                    <select disabled={!canEdit} className={`${input} bg-white`} value={r.cancelCat2Id ?? ""}
                      onChange={(e) => patch(r._key, { cancelCat2Id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">（未選択）</option>
                      {cat2.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>{groupLabel("refund_status", "解約進捗ステータス")}</label>
                    <select disabled={!canEdit} className={`${input} bg-white`} value={r.statusId ?? ""}
                      onChange={(e) => patch(r._key, { statusId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">（未選択）</option>
                      {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDone ? "（完了扱い）" : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>返金完了日時 {isDone(r.statusId) && <span className="text-red-500">*</span>}</label>
                    <input type="datetime-local" disabled={!canEdit}
                      className={`${input} ${isDone(r.statusId) && !r.refundedAt ? "border-red-300 bg-red-50" : ""}`}
                      value={r.refundedAt} onChange={(e) => patch(r._key, { refundedAt: e.target.value })} />
                    <p className="text-[10.5px] text-gray-400 mt-1">この年月が売上レポートの計上月になります。</p>
                  </div>
                  <div>
                    <label className={label}>元決済ID（任意）</label>
                    <input type="number" inputMode="numeric" disabled={!canEdit} className={input} value={r.paymentId ?? ""}
                      placeholder="決済一覧の対象決済ID"
                      onChange={(e) => patch(r._key, { paymentId: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                </div>

                {/* 経費・出金への計上 */}
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider mb-2">経費・出金への計上</div>
                  {expensesAvailable() === false ? (
                    <p className="text-[11.5px] text-gray-500">
                      経費の初期設定がまだです。<button onClick={() => router.push("/ops/expenses")} className="font-bold text-red-600 hover:underline">経費を開く</button> から科目を用意すると、ここで選べるようになります。
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
                        <div>
                          <label className={label}>経費科目</label>
                          <select disabled={!canEdit} className={`${input} bg-white`} value={r.expenseCategoryId ?? ""}
                            onChange={(e) => patch(r._key, { expenseCategoryId: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">（未選択）</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={label}>出金経路</label>
                          <select disabled={!canEdit} className={`${input} bg-white`} value={r.payoutSiteId ?? ""}
                            onChange={(e) => patch(r._key, { payoutSiteId: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">（未選択）</option>
                            {sites.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={label}>出金方法</label>
                          <select disabled={!canEdit} className={`${input} bg-white`} value={r.payoutMethodId ?? ""}
                            onChange={(e) => patch(r._key, { payoutMethodId: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">（未選択）</option>
                            {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={label}>出金予定日</label>
                          <input type="date" disabled={!canEdit} className={input} value={r.payoutExpectedDate}
                            onChange={(e) => patch(r._key, { payoutExpectedDate: e.target.value })} />
                        </div>
                      </div>
                      <p className="text-[10.5px] text-gray-400 mt-2">
                        完了扱いのステータスにすると、保存時に経費として計上されます（出金予定日 {refundExpectedDate(r) || "未定"}）。出金の消込は 収支 ＞ 売上経費一覧 ＞ 入金出金 で行います。
                      </p>
                    </>
                  )}
                </div>

                {/* 理由・メモ */}
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                  <div>
                    <label className={label}>理由</label>
                    <textarea disabled={!canEdit} className={`${input} min-h-[48px]`} value={r.reason}
                      placeholder="クーリングオフ期間内の申し出 など"
                      onChange={(e) => patch(r._key, { reason: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>進捗メモ</label>
                    <textarea disabled={!canEdit} className={`${input} min-h-[48px]`} value={r.progressMemo}
                      placeholder="7/22 受付 → 7/23 上長確認済 → 振込手続き待ち"
                      onChange={(e) => patch(r._key, { progressMemo: e.target.value })} />
                  </div>
                </div>

                {/* 申請者 */}
                <details className="rounded-xl border border-gray-200 bg-white">
                  <summary className="px-3 py-2 text-[11.5px] font-semibold text-gray-500 cursor-pointer select-none">
                    申請者情報（対象者と異なる場合）
                  </summary>
                  <div className="px-3 pb-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                    <div>
                      <label className={label}>申請者氏名</label>
                      <input disabled={!canEdit} className={input} value={r.applicantName} placeholder="田中 太郎"
                        onChange={(e) => patch(r._key, { applicantName: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>申請者電話番号</label>
                      <input disabled={!canEdit} className={input} value={r.applicantTel} placeholder="090-1234-5678"
                        onChange={(e) => patch(r._key, { applicantTel: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>申請者メールアドレス</label>
                      <input disabled={!canEdit} className={input} value={r.applicantEmail} placeholder="tanaka@example.com"
                        onChange={(e) => patch(r._key, { applicantEmail: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>申請者住所</label>
                      <input disabled={!canEdit} className={input} value={r.applicantAddress} placeholder="〒150-0001 東京都渋谷区…"
                        onChange={(e) => patch(r._key, { applicantAddress: e.target.value })} />
                    </div>
                    <div className="col-span-full">
                      <label className={label}>備考</label>
                      <input disabled={!canEdit} className={input} value={r.note} placeholder="振込先など"
                        onChange={(e) => patch(r._key, { note: e.target.value })} />
                    </div>
                  </div>
                </details>

                {canEdit && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => void removeRow(r)}
                      className="text-[11.5px] font-semibold text-red-600 border border-red-200 rounded-lg px-2.5 py-1.5 hover:bg-red-50">
                      この行を削除
                    </button>
                    <div className="flex-1" />
                    <span className={`text-[11px] ${dirty ? "text-amber-700 font-bold" : "text-gray-400"}`}>
                      {dirty ? "未保存の変更があります" : "保存済み"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── 次の1手 ── */}
      {canEdit && !loading && (
        <div className="px-4 py-3">
          <button onClick={addRow}
            className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
            ＋ 返金・解約を追加
          </button>
        </div>
      )}

      {/* ── フッタ ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#faf9f7] border-t border-gray-100">
        <span className="text-[12px] text-gray-500">返金額 累計（完了）</span>
        <span className="flex items-baseline gap-4">
          {unsettled > 0 && <span className="text-[11.5px] text-amber-700">未消込 {formatYen(unsettled)}</span>}
          <span className="text-[15px] font-bold text-gray-800 tabular-nums">{formatYen(bookedTotal)}</span>
        </span>
      </div>
    </div>
  );
}
