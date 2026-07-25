"use client";
// ============================================================
// 返金・解約管理（独立ルート /ops/refunds）
//
//   左：返金・解約一覧（サマリ＋絞り込み）／右：申請者情報＋対象者照合＋入力（左右分割）。
//   ・解約区分①/②・進捗ステータスはマスタから選択（DBは番号で保持）。
//   ・申請者（applicant*）は対象者会員と別に入力（家族・代理申請に対応）。
//   ・進捗ステータスが「完了扱い(is_done)」なら返金完了日時を必須化（計上月の確定）。
//   ・返金額は売上レポートに「経費」として計上（完了扱いを対象、refunded_at を計上月に）。
//   ・会員照合は payments と同じ email 一意＋氏名候補（手動照合は常に可）。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchRefunds, saveRefund, deleteRefund, formatYen,
  fetchRefundMasterOptions, fetchRefundMasterGroups, refundMasterName, doneStatusIds,
  matchMemberByEmail, findMemberCandidates,
  type MemberLite,
} from "../../lib/refunds";
import type { Refund, RefundMaster, RefundMasterGroup, RefundKind } from "../../lib/models";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

const fmtDt = (s: string) => (s ? s.replace("T", " ") : "—");
const KIND_LABEL: Record<RefundKind, string> = { refund: "返金", cancel: "解約", both: "返金＋解約" };

const newRefund = (): Refund => ({
  id: 0, memberId: null, paymentId: null, customerName: "", customerEmail: "",
  applicantName: "", applicantAddress: "", applicantEmail: "", applicantTel: "",
  cancelCat1Id: null, cancelCat2Id: null, statusId: null,
  kind: "refund", refundAmount: 0, expenseCategory: "refund",
  requestedAt: "", refundedAt: "", reason: "", progressMemo: "", note: "",
  screenshotPath: null, createdAt: "",
});

export function RefundView() {
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Refund[]>([]);
  const [cat1, setCat1] = useState<RefundMaster[]>([]);
  const [cat2, setCat2] = useState<RefundMaster[]>([]);
  const [statuses, setStatuses] = useState<RefundMaster[]>([]);
  const [groups, setGroups] = useState<RefundMasterGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [statusFilter, setStatusFilter] = useState<number | "">("");
  const [rEdit, setREdit] = useState<Refund | null>(null);
  const [candKw, setCandKw] = useState("");
  const [cand, setCand] = useState<MemberLite[]>([]);

  const groupLabel = (key: string, fallback: string) => groups.find((g) => g.key === key)?.label || fallback;
  const doneIds = useMemo(() => doneStatusIds(statuses), [statuses]);

  const reload = async () => { try { setRows(await fetchRefunds()); } catch (e) { console.error("返金解約読込エラー:", e); } };
  useEffect(() => {
    (async () => {
      try {
        const [rs, opts, gs] = await Promise.all([fetchRefunds(), fetchRefundMasterOptions(), fetchRefundMasterGroups()]);
        setRows(rs); setCat1(opts.cancel_cat1); setCat2(opts.cancel_cat2); setStatuses(opts.refund_status); setGroups(gs);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const openEdit = (r: Refund) => { setREdit({ ...r }); setCand([]); setCandKw(""); };

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "" && r.statusId !== statusFilter) return false;
      if (!k) return true;
      return [r.customerName, r.customerEmail, r.applicantName, r.applicantEmail, r.applicantTel]
        .some((s) => (s ?? "").toLowerCase().includes(k));
    });
  }, [rows, kw, statusFilter]);

  const sumAmount = useMemo(() => filtered.reduce((s, r) => s + (r.refundAmount || 0), 0), [filtered]);
  const doneExpenseAll = useMemo(
    () => rows.reduce((s, r) => s + (r.statusId != null && doneIds.has(r.statusId) ? (r.refundAmount || 0) : 0), 0),
    [rows, doneIds]);
  const openCount = useMemo(
    () => rows.filter((r) => r.statusId == null || !doneIds.has(r.statusId)).length,
    [rows, doneIds]);

  const isDoneStatus = (id: number | null) => id != null && doneIds.has(id);

  // ── 会員照合 ──
  const tryMatchEmail = async (email: string) => {
    if (!rEdit) return;
    const m = await matchMemberByEmail(email);
    if (m) {
      setREdit({ ...rEdit, memberId: m.id, customerName: m.name, customerEmail: m.email });
      toast.success(`メール一致：${m.name} さんに照合しました`);
    } else {
      toast.error("メール一致する会員が見つかりませんでした（氏名で検索してください）");
    }
  };
  const searchCand = async (k: string) => { setCandKw(k); setCand(k.trim() ? await findMemberCandidates(k) : []); };
  const pickMember = (m: MemberLite) => {
    if (!rEdit) return;
    setREdit({ ...rEdit, memberId: m.id, customerName: m.name, customerEmail: m.email || rEdit.customerEmail });
    setCand([]); setCandKw("");
  };
  const unmatch = () => { if (rEdit) setREdit({ ...rEdit, memberId: null }); };
  const copyMemberToApplicant = () => {
    if (!rEdit) return;
    setREdit({ ...rEdit, applicantName: rEdit.customerName || rEdit.applicantName, applicantEmail: rEdit.customerEmail || rEdit.applicantEmail });
  };

  const doSave = async () => {
    if (!rEdit) return;
    if (!rEdit.requestedAt) { alert("受付日時を入力してください"); return; }
    if (isDoneStatus(rEdit.statusId) && !rEdit.refundedAt) { alert("完了扱いのステータスでは返金完了日時が必要です"); return; }
    const res = await saveRefund(rEdit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setREdit(null); await reload();
    toast.success("保存しました");
  };
  const doDelete = async () => {
    if (!rEdit?.id) return;
    if (!(await confirm({ title: "返金・解約を削除", message: "この返金・解約情報を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    await deleteRefund(rEdit.id); setREdit(null); await reload();
    toast.success("削除しました");
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const detailOpen = !!rEdit;

  const statusBadge = (id: number | null) => {
    const done = isDoneStatus(id);
    const cls = done ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600";
    return <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{refundMasterName(statuses, id)}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">返金・解約</h1>
        <span className="text-xs text-gray-400">決済への返金・解約を登録し、進捗を管理します。返金額は売上レポートに経費計上されます。</span>
      </div>

      {/* サマリ */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">表示中 件数</div><div className="text-xl font-bold text-gray-800">{filtered.length} 件</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">返金額 合計（表示中）</div><div className="text-xl font-bold text-gray-800">{formatYen(sumAmount)}</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">未完了</div><div className="text-xl font-bold text-amber-600">{openCount} 件</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">返金経費（完了）</div><div className="text-xl font-bold text-red-600">{formatYen(doneExpenseAll)}</div></div>
      </div>

      {/* ツールバー */}
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${input} max-w-xs`} placeholder="対象者・申請者（氏名・メール・電話）で検索" value={kw} onChange={(e) => setKw(e.target.value)} />
        <select className={`${input} bg-white`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{groupLabel("refund_status", "進捗ステータス")}（すべて）</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => router.push("/ops/refundmaster")} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50">マスタ編集</button>
        <button onClick={() => openEdit(newRefund())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 返金・解約を登録</button>
      </div>

      <div className={detailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start" : ""}>
        {/* ── 左：一覧 ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {filtered.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">返金・解約がありません。「＋ 返金・解約を登録」から追加してください。</div>
            : filtered.map((r, i) => (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${rEdit && rEdit.id === r.id && r.id !== 0 ? "bg-red-50" : ""}`}>
                <div className="w-[78px] shrink-0 text-[11px] text-gray-500">{fmtDt(r.requestedAt).slice(0, 10)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold truncate ${r.memberId ? "text-indigo-700" : "text-gray-800"}`}>{r.customerName || r.applicantName || "（氏名なし）"}</div>
                  <div className="text-[11px] text-gray-400 truncate">{KIND_LABEL[r.kind]} ・ {refundMasterName(cat1, r.cancelCat1Id)} / {refundMasterName(cat2, r.cancelCat2Id)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-800 tabular-nums">{formatYen(r.refundAmount)}</div>
                </div>
                {statusBadge(r.statusId)}
                <button onClick={() => openEdit(r)} className="shrink-0 text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
              </div>
            ))}
        </div>

        {/* ── 右：編集パネル ── */}
        {rEdit && (
        <div className="lg:sticky lg:top-4 self-start min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{rEdit.id ? "返金・解約を編集" : "返金・解約を登録"}</h2>
              <button onClick={() => setREdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* 区分 */}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">区分</label>
                <div className="flex gap-2">
                  {(["refund", "cancel", "both"] as RefundKind[]).map((k) => (
                    <button key={k} onClick={() => setREdit({ ...rEdit, kind: k })}
                      className={`flex-1 text-xs font-bold rounded-lg px-2 py-2 border ${rEdit.kind === k ? "border-red-300 bg-red-50 text-red-600" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              {/* マスタ参照 */}
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">{groupLabel("cancel_cat1", "解約区分①")} <span className="text-gray-400 font-normal">マスタ</span></label>
                  <select className={`${input} bg-white`} value={rEdit.cancelCat1Id ?? ""} onChange={(e) => setREdit({ ...rEdit, cancelCat1Id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{cat1.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">{groupLabel("cancel_cat2", "解約区分②")} <span className="text-gray-400 font-normal">マスタ</span></label>
                  <select className={`${input} bg-white`} value={rEdit.cancelCat2Id ?? ""} onChange={(e) => setREdit({ ...rEdit, cancelCat2Id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{cat2.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></div>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">{groupLabel("refund_status", "解約進捗ステータス")} <span className="text-gray-400 font-normal">マスタ</span></label>
                <select className={`${input} bg-white`} value={rEdit.statusId ?? ""} onChange={(e) => setREdit({ ...rEdit, statusId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">（未選択）</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDone ? "（完了扱い）" : ""}</option>)}
                </select>
                {isDoneStatus(rEdit.statusId) && !rEdit.refundedAt && <p className="text-[11px] text-amber-600 mt-1">完了扱いのため、返金完了日時を入力してください。</p>}
              </div>

              {/* 金額 */}
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">返金金額（円）</label>
                  <input type="number" inputMode="numeric" className={input} value={rEdit.refundAmount || ""} onChange={(e) => setREdit({ ...rEdit, refundAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="30000" />
                  <p className="text-[11px] text-gray-400 mt-1">売上レポートに経費計上する金額</p></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">経費区分</label>
                  <select className={`${input} bg-white`} value={rEdit.expenseCategory} onChange={(e) => setREdit({ ...rEdit, expenseCategory: e.target.value })}>
                    <option value="refund">返金（refund）</option>
                    <option value="chargeback">手数料戻し（chargeback）</option>
                    <option value="other">その他（other）</option>
                  </select></div>
              </div>

              {/* 日付 */}
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">受付日時 <span className="text-red-500">*</span></label>
                  <input type="datetime-local" className={input} value={rEdit.requestedAt} onChange={(e) => setREdit({ ...rEdit, requestedAt: e.target.value })} /></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">返金完了日時</label>
                  <input type="datetime-local" className={input} value={rEdit.refundedAt} onChange={(e) => setREdit({ ...rEdit, refundedAt: e.target.value })} />
                  <p className="text-[11px] text-gray-400 mt-1">この年月が売上レポートの計上月になります。</p></div>
              </div>

              {/* 元決済 */}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">元決済ID（任意）</label>
                <input type="number" inputMode="numeric" className={input} value={rEdit.paymentId ?? ""} onChange={(e) => setREdit({ ...rEdit, paymentId: e.target.value ? Number(e.target.value) : null })} placeholder="決済一覧の対象決済ID" />
                <p className="text-[11px] text-gray-400 mt-1">決済一覧で対象決済のIDを確認して入力（部分返金・複数回返金も可）。</p></div>

              {/* 理由・メモ */}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">理由</label>
                <textarea className={`${input} min-h-[52px]`} value={rEdit.reason} onChange={(e) => setREdit({ ...rEdit, reason: e.target.value })} placeholder="クーリングオフ期間内の申し出 など" /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">進捗メモ</label>
                <textarea className={`${input} min-h-[52px]`} value={rEdit.progressMemo} onChange={(e) => setREdit({ ...rEdit, progressMemo: e.target.value })} placeholder="7/22 受付 → 7/23 上長確認済 → 振込手続き待ち" /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                <textarea className={`${input} min-h-[44px]`} value={rEdit.note} onChange={(e) => setREdit({ ...rEdit, note: e.target.value })} placeholder="振込先など" /></div>

              {/* 申請者情報 */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="text-[11px] font-bold text-gray-500">申請者情報</div>
                  <div className="flex-1" />
                  <button onClick={copyMemberToApplicant} className="text-[11px] font-semibold text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">会員情報をコピー</button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className="text-[11px] text-gray-500 block mb-1">申請者氏名</label>
                    <input className={input} value={rEdit.applicantName} onChange={(e) => setREdit({ ...rEdit, applicantName: e.target.value })} placeholder="田中 太郎" /></div>
                  <div><label className="text-[11px] text-gray-500 block mb-1">申請者電話番号</label>
                    <input className={input} value={rEdit.applicantTel} onChange={(e) => setREdit({ ...rEdit, applicantTel: e.target.value })} placeholder="090-1234-5678" /></div>
                </div>
                <div><label className="text-[11px] text-gray-500 block mb-1">申請者住所</label>
                  <input className={input} value={rEdit.applicantAddress} onChange={(e) => setREdit({ ...rEdit, applicantAddress: e.target.value })} placeholder="〒150-0001 東京都渋谷区…" /></div>
                <div><label className="text-[11px] text-gray-500 block mb-1">申請者メールアドレス</label>
                  <input className={input} value={rEdit.applicantEmail} onChange={(e) => setREdit({ ...rEdit, applicantEmail: e.target.value })} placeholder="tanaka@example.com" /></div>
                <p className="text-[11px] text-gray-400">対象者会員と異なる場合あり（家族・代理申請）。</p>
              </div>

              {/* 対象者照合 */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
                <div className="text-[11px] font-bold text-gray-500">対象者（メンバー照合）</div>
                {rEdit.memberId ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <span className="w-7 h-7 rounded-full bg-emerald-200 text-emerald-800 grid place-items-center text-[12px] font-bold shrink-0">{(rEdit.customerName || "?").slice(0, 1)}</span>
                      <div className="flex-1 min-w-0"><div className="text-[12.5px] font-bold text-emerald-800 truncate">{rEdit.customerName}（会員）</div><div className="text-[11px] text-emerald-700 truncate">{rEdit.customerEmail}</div></div>
                      <button onClick={unmatch} className="text-[11px] font-semibold text-gray-500 border border-gray-200 bg-white rounded px-2 py-1 hover:bg-gray-50 shrink-0">解除</button>
                    </div>
                    <button onClick={() => router.push(`/ops/members/${rEdit.memberId}`)} className="text-[11.5px] font-bold text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50">メンバー詳細を開く ↗（属性付与）</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button onClick={() => rEdit.applicantEmail && tryMatchEmail(rEdit.applicantEmail)} className="text-[11.5px] font-semibold text-gray-600 border border-gray-200 rounded px-2.5 py-1.5 hover:bg-gray-50 whitespace-nowrap">申請者メールで照合</button>
                      <input className={`${input} flex-1 py-1.5`} value={candKw} onChange={(e) => searchCand(e.target.value)} placeholder="氏名・メールで会員を検索して選ぶ" />
                    </div>
                    {cand.length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        {cand.map((m) => (
                          <button key={m.id} onClick={() => pickMember(m)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0">
                            <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 grid place-items-center text-[11px] font-bold shrink-0">{(m.name || "?").slice(0, 1)}</span>
                            <span className="flex-1 min-w-0"><span className="text-[12.5px] font-bold text-gray-800 block truncate">{m.name}</span><span className="text-[11px] text-gray-400 block truncate">{m.email} ・ {m.company}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400">未照合のまま登録もできます（後から照合可）。</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {rEdit.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setREdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
