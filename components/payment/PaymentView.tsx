"use client";
// ============================================================
// 決済情報管理（独立ルート /ops/payments）
//
//   左：決済一覧（サマリ＋絞り込み）／右：登録・編集パネル（左右分割）。
//   ・商品種別 / 決済サイト / 決済方法はマスタから選択（DBは番号で保持）。
//   ・売上計上金額は空/0 で登録すると決済金額を自動セット（保存時）。
//   ・スクショ → AI読取。名称はマスタへ突合してIDに変換。
//   ・会員照合は email 一意＋氏名候補（手動照合は常に可）。
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPayments, savePayment, deletePayment, formatYen, nameOf,
  matchMemberByEmail, findMemberCandidates, uploadPaymentShot, removePaymentShot,
  requestShotUrl, extractPaymentFromImage, fetchMasterOptions, matchMasterByName,
  type MemberLite,
} from "../../lib/payments";
import type { Payment, PaymentMaster } from "../../lib/models";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const warnInput = "w-full border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400";
const fmtDt = (s: string) => (s ? s.replace("T", " ") : "—");

const newPayment = (): Payment => ({
  id: 0, memberId: null, customerName: "", customerKana: "", customerEmail: "", customerTel: "",
  paidAt: "", typeId: null, siteId: null, methodId: null, amount: 0, recognizedAmount: 0,
  currency: "JPY", note: "", status: "unmatched", screenshotPath: null, createdAt: "",
});

export function PaymentView() {
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<Payment[]>([]);
  const [types, setTypes] = useState<PaymentMaster[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);
  const [methods, setMethods] = useState<PaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [pEdit, setPEdit] = useState<Payment | null>(null);
  const [lowConf, setLowConf] = useState<Set<string>>(new Set());
  // スクショ入力：ファイル参照ボタン用の隠しinputと、貼り付け欄に出す状態表示
  const shotFileRef = useRef<HTMLInputElement>(null);
  const [shotLabel, setShotLabel] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [matchName, setMatchName] = useState("");
  const [candKw, setCandKw] = useState("");
  const [cand, setCand] = useState<MemberLite[]>([]);

  const reload = async () => { try { setRows(await fetchPayments()); } catch (e) { console.error("決済読込エラー:", e); } };
  useEffect(() => {
    (async () => {
      try {
        const [ps, m] = await Promise.all([fetchPayments(), fetchMasterOptions()]);
        setRows(ps); setTypes(m.types); setSites(m.sites); setMethods(m.methods);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const openEdit = (p: Payment) => {
    setPEdit({ ...p }); setLowConf(new Set());
    setMatchName(p.memberId ? p.customerName : ""); setCand([]); setCandKw("");
  };

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return rows.filter((p) => {
      if (onlyUnmatched && p.status !== "unmatched") return false;
      if (!k) return true;
      return [p.customerName, p.customerKana, p.customerEmail, p.customerTel].some((s) => (s ?? "").toLowerCase().includes(k));
    });
  }, [rows, kw, onlyUnmatched]);

  const sumAmount = useMemo(() => filtered.reduce((s, p) => s + (p.amount || 0), 0), [filtered]);
  const sumRecognized = useMemo(() => filtered.reduce((s, p) => s + (p.recognizedAmount || 0), 0), [filtered]);
  const unmatchedCount = useMemo(() => rows.filter((p) => p.status === "unmatched").length, [rows]);

  // ── 商品種別の選択で、売上計上金額が未入力(0)なら必要金額を初期表示 ──
  const onSelectType = (id: number | null) => {
    if (!pEdit) return;
    const t = id != null ? types.find((x) => x.id === id) : undefined;
    const next: Payment = { ...pEdit, typeId: id };
    if ((!pEdit.recognizedAmount || pEdit.recognizedAmount === 0) && t?.requiredAmount) next.recognizedAmount = t.requiredAmount;
    setPEdit(next);
  };

  // ── AI スクショ読取（＋スクショ保存）──
  const onPickShot = async (file: File) => {
    if (!pEdit) return;
    setAiBusy(true);
    setShotLabel(file.name || "貼り付けた画像");
    try {
      const [ex, up] = await Promise.all([extractPaymentFromImage(file), uploadPaymentShot(file)]);
      if (up.path && pEdit.screenshotPath) await removePaymentShot(pEdit.screenshotPath);
      const d = ex.data ?? {};
      const t = matchMasterByName(types, d.typeName);
      const s = matchMasterByName(sites, d.siteName);
      const me = matchMasterByName(methods, d.methodName);
      const next: Payment = {
        ...pEdit,
        paidAt: d.paidAt ?? pEdit.paidAt,
        typeId: t?.id ?? pEdit.typeId,
        siteId: s?.id ?? pEdit.siteId,
        methodId: me?.id ?? pEdit.methodId,
        amount: d.amount ?? pEdit.amount,
        recognizedAmount: d.recognizedAmount ?? pEdit.recognizedAmount,
        customerEmail: d.customerEmail ?? pEdit.customerEmail,
        customerName: d.customerName ?? pEdit.customerName,
        customerKana: d.customerKana ?? pEdit.customerKana,
        customerTel: d.customerTel ?? pEdit.customerTel,
        currency: d.currency ?? pEdit.currency,
        screenshotPath: up.path ?? pEdit.screenshotPath,
      };
      setPEdit(next);
      const lc = new Set(d.lowConfidence ?? []);
      if (d.typeName && !t) { lc.add("typeId"); toast.error(`商品種別「${d.typeName}」がマスタに未登録です`); }
      if (d.siteName && !s) lc.add("siteId");
      if (d.methodName && !me) lc.add("methodId");
      setLowConf(lc);
      if (ex.error) toast.error(`読み取り：${ex.error}`);
      else toast.success("スクショから読み取りました（内容をご確認ください）");
      if (d.customerEmail) await tryMatchEmail(d.customerEmail, next);
    } finally { setAiBusy(false); }
  };

  /** クリップボードから画像を取り出して読取にかける（貼り付け欄・画面全体で共用） */
  const pickImageFromClipboard = (items: DataTransferItemList | undefined): File | null => {
    if (!items) return null;
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) return it.getAsFile();
    }
    return null;
  };

  // ── Ctrl+V でスクショを貼り付け → そのまま AI 読取 ──
  //   登録パネル（pEdit）を開いている間だけ有効。クリップボードに画像があるときのみ処理し、
  //   テキスト貼り付け（入力欄への通常の貼り付け）は妨げない。
  //   ⚠️ 貼り付け欄（data-shot-paste）で受けた分は二重処理しない。
  useEffect(() => {
    if (!pEdit || aiBusy) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-shot-paste]")) return;
      const f = pickImageFromClipboard(e.clipboardData?.items);
      if (f) { e.preventDefault(); onPickShot(f); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pEdit, aiBusy]);

  // ── 会員照合 ──
  const tryMatchEmail = async (email: string, base?: Payment) => {
    const b = base ?? pEdit;
    if (!b) return;
    const m = await matchMemberByEmail(email);
    if (m) {
      setPEdit({ ...b, memberId: m.id, customerName: m.name, customerEmail: m.email, status: "matched" });
      setMatchName(m.name);
      toast.success(`メール一致：${m.name} さんに照合しました`);
    } else {
      toast.error("メール一致する会員が見つかりませんでした（氏名で検索してください）");
    }
  };
  const searchCand = async (k: string) => { setCandKw(k); setCand(k.trim() ? await findMemberCandidates(k) : []); };
  const pickMember = (m: MemberLite) => {
    if (!pEdit) return;
    setPEdit({ ...pEdit, memberId: m.id, customerName: m.name, customerEmail: m.email || pEdit.customerEmail, status: "matched" });
    setMatchName(m.name); setCand([]); setCandKw("");
  };
  const unmatch = () => { if (pEdit) { setPEdit({ ...pEdit, memberId: null, status: "unmatched" }); setMatchName(""); } };

  const openShot = async () => {
    if (!pEdit?.id) return;
    const r = await requestShotUrl(pEdit.id);
    if (r.url) window.open(r.url, "_blank", "noopener");
    else toast.error(r.error ?? "スクショを開けませんでした");
  };

  const doSave = async () => {
    if (!pEdit) return;
    if (!pEdit.paidAt) { alert("決済完了日時を入力してください"); return; }
    if (!pEdit.amount || pEdit.amount <= 0) { alert("決済金額を入力してください"); return; }
    const res = await savePayment(pEdit);   // 売上計上金額が空/0 なら決済金額を自動セット（server helper）
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setPEdit(null); await reload();
    toast.success("保存しました");
  };
  const doDelete = async () => {
    if (!pEdit?.id) return;
    if (!(await confirm({ title: "決済を削除", message: "この決済情報を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    await deletePayment(pEdit.id); setPEdit(null); await reload();
    toast.success("削除しました");
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const detailOpen = !!pEdit;
  const inCls = (k: string) => (lowConf.has(k) ? warnInput : input);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">決済</h1>
        <span className="text-xs text-gray-400">外部決済サイトで確認した決済を登録・照合します。</span>
      </div>

      {/* サマリ */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">表示中 件数</div><div className="text-xl font-bold text-gray-800">{filtered.length} 件</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">決済金額 合計</div><div className="text-xl font-bold text-gray-800">{formatYen(sumAmount)}</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">売上計上額 合計</div><div className="text-xl font-bold text-gray-800">{formatYen(sumRecognized)}</div></div>
        <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">未照合</div><div className="text-xl font-bold text-red-600">{unmatchedCount} 件</div></div>
      </div>

      {/* ツールバー */}
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${input} max-w-xs`} placeholder="顧客名・カナ・メール・電話で検索" value={kw} onChange={(e) => setKw(e.target.value)} />
        <button onClick={() => setOnlyUnmatched((v) => !v)} className={`px-3 py-2 rounded-lg border text-sm font-semibold ${onlyUnmatched ? "border-red-300 bg-red-50 text-red-600" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>未照合のみ</button>
        <div className="flex-1" />
        <button onClick={() => openEdit(newPayment())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 決済を登録</button>
      </div>

      <div className={detailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start" : ""}>
        {/* ── 左：一覧 ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {filtered.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">決済がありません。「＋ 決済を登録」から追加してください。</div>
            : filtered.map((p, i) => (
              <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${pEdit && pEdit.id === p.id && p.id !== 0 ? "bg-red-50" : ""}`}>
                <div className="w-[92px] shrink-0 text-[11px] text-gray-500">{fmtDt(p.paidAt).slice(0, 16)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold truncate ${p.memberId ? "text-indigo-700" : "text-gray-800"}`}>{p.customerName || "（氏名なし）"}</div>
                  <div className="text-[11px] text-gray-400 truncate">{nameOf(types, p.typeId)} ・ {nameOf(sites, p.siteId)} / {nameOf(methods, p.methodId)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-800 tabular-nums">{formatYen(p.amount)}</div>
                  <div className="text-[10.5px] text-gray-400 tabular-nums">計上 {formatYen(p.recognizedAmount)}</div>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${p.status === "matched" ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"}`}>{p.status === "matched" ? "照合済" : "未照合"}</span>
                <button onClick={() => openEdit(p)} className="shrink-0 text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
              </div>
            ))}
        </div>

        {/* ── 右：編集パネル ── */}
        {pEdit && (
        <div className="lg:sticky lg:top-4 self-start min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{pEdit.id ? "決済を編集" : "決済を登録"}</h2>
              <div className="flex items-center gap-2.5">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pEdit.status === "matched" ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"}`}>{pEdit.status === "matched" ? "照合済" : "未照合"}</span>
                <button onClick={() => setPEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* スクショ＋AI読取 */}
              <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 p-3">
                <div className="text-[11px] font-extrabold text-indigo-700 mb-1.5">✦ スクショから AI 読み取り</div>
                <div className="flex gap-2">
                  {/* 入力フィールド：クリックして Ctrl+V でコピー中のスクショを送信 */}
                  <input
                    type="text"
                    data-shot-paste="1"
                    disabled={aiBusy}
                    value={aiBusy ? "読み取り中…" : shotLabel}
                    onChange={() => { /* 直接入力は受け付けない（貼り付け／参照専用）。readOnly だと paste が発火しないブラウザがあるため onChange で固定する */ }}
                    placeholder="ここをクリックして Ctrl+V で貼り付け"
                    title="コピー中のスクリーンショットをこの欄に貼り付け（Ctrl+V / ⌘V）"
                    onPaste={(e) => {
                      const f = pickImageFromClipboard(e.clipboardData?.items);
                      if (f) { e.preventDefault(); onPickShot(f); }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const f = e.dataTransfer?.files?.[0];
                      if (f && f.type.startsWith("image/")) { e.preventDefault(); onPickShot(f); }
                    }}
                    className="flex-1 min-w-0 border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white text-indigo-800 placeholder:text-indigo-300 focus:outline-none focus:border-indigo-500 disabled:opacity-60 cursor-text"
                  />
                  {/* ファイル参照ボタン */}
                  <button type="button" disabled={aiBusy} onClick={() => shotFileRef.current?.click()}
                    className="shrink-0 rounded-lg border border-indigo-300 bg-white px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                    ファイル参照
                  </button>
                  <input ref={shotFileRef} type="file" accept="image/*" className="hidden" disabled={aiBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickShot(f); e.target.value = ""; }} />
                </div>
                <p className="text-[11px] text-indigo-500 mt-1.5 leading-relaxed">決済画面のスクショから各項目へ下書き反映。入力欄に<b>Ctrl+V で貼り付け</b>（ドラッグ＆ドロップも可）、または「ファイル参照」から選択します。名称はマスタに突合します。画像は圧縮してプライベート保存され、閲覧は署名URL経由です。</p>
                {pEdit.screenshotPath && <button onClick={openShot} className="mt-2 text-[11px] font-semibold text-indigo-700 border border-indigo-200 rounded px-2 py-1 hover:bg-white">保存済みスクショを開く ↗</button>}
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">決済完了日時 <span className="text-red-500">*</span></label>
                <input type="datetime-local" className={inCls("paidAt")} value={pEdit.paidAt} onChange={(e) => setPEdit({ ...pEdit, paidAt: e.target.value })} /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">商品種別 <span className="text-gray-400 font-normal">マスタ参照</span></label>
                <select className={`${inCls("typeId")} bg-white`} value={pEdit.typeId ?? ""} onChange={(e) => onSelectType(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">（未選択）</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>

              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">決済サイト</label>
                  <select className={`${inCls("siteId")} bg-white`} value={pEdit.siteId ?? ""} onChange={(e) => setPEdit({ ...pEdit, siteId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">決済方法</label>
                  <select className={`${inCls("methodId")} bg-white`} value={pEdit.methodId ?? ""} onChange={(e) => setPEdit({ ...pEdit, methodId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">（未選択）</option>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">決済金額（円） <span className="text-red-500">*</span></label>
                  <input type="number" inputMode="numeric" className={inCls("amount")} value={pEdit.amount || ""} onChange={(e) => setPEdit({ ...pEdit, amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="55000" /></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">売上計上金額（円）</label>
                  <input type="number" inputMode="numeric" className={inCls("recognizedAmount")} value={pEdit.recognizedAmount || ""} onChange={(e) => setPEdit({ ...pEdit, recognizedAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="空欄なら決済金額を自動セット" />
                  <p className="text-[11px] text-gray-400 mt-1">手数料を差し引いた計上額。空/0 は保存時に決済金額をセット。</p></div>
              </div>

              {/* 顧客・照合 */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
                <div className="text-[11px] font-bold text-gray-500">顧客（メンバー照合）</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className="text-[11px] text-gray-500 block mb-1">メール</label>
                    <input className={inCls("customerEmail")} value={pEdit.customerEmail} onChange={(e) => setPEdit({ ...pEdit, customerEmail: e.target.value })} onBlur={(e) => { if (!pEdit.memberId && e.target.value) tryMatchEmail(e.target.value); }} placeholder="tanaka@example.com" /></div>
                  <div><label className="text-[11px] text-gray-500 block mb-1">電話番号</label>
                    <input className={inCls("customerTel")} value={pEdit.customerTel} onChange={(e) => setPEdit({ ...pEdit, customerTel: e.target.value })} placeholder="090-1234-5678" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className="text-[11px] text-gray-500 block mb-1">氏名</label>
                    <input className={inCls("customerName")} value={pEdit.customerName} onChange={(e) => setPEdit({ ...pEdit, customerName: e.target.value })} placeholder="田中 太郎" /></div>
                  <div><label className="text-[11px] text-gray-500 block mb-1">氏名カナ</label>
                    <input className={inCls("customerKana")} value={pEdit.customerKana} onChange={(e) => setPEdit({ ...pEdit, customerKana: e.target.value })} placeholder="タナカ タロウ" /></div>
                </div>

                {pEdit.memberId ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <span className="w-7 h-7 rounded-full bg-emerald-200 text-emerald-800 grid place-items-center text-[12px] font-bold shrink-0">{(matchName || pEdit.customerName || "?").slice(0, 1)}</span>
                    <div className="flex-1 min-w-0"><div className="text-[12.5px] font-bold text-emerald-800 truncate">{matchName || pEdit.customerName}（会員）</div><div className="text-[11px] text-emerald-700 truncate">{pEdit.customerEmail}</div></div>
                    <button onClick={unmatch} className="text-[11px] font-semibold text-gray-500 border border-gray-200 bg-white rounded px-2 py-1 hover:bg-gray-50 shrink-0">解除</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button onClick={() => pEdit.customerEmail && tryMatchEmail(pEdit.customerEmail)} className="text-[11.5px] font-semibold text-gray-600 border border-gray-200 rounded px-2.5 py-1.5 hover:bg-gray-50 whitespace-nowrap">メールで自動照合</button>
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

              <div><label className="text-xs font-bold text-gray-500 block mb-1">備考</label>
                <textarea className={`${input} min-h-[64px]`} value={pEdit.note} onChange={(e) => setPEdit({ ...pEdit, note: e.target.value })} placeholder="銀行振込・入金確認済み など" /></div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {pEdit.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setPEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
