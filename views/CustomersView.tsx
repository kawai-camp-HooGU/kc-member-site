"use client";
// ============================================================
// 顧客一覧（データ種別：会員 / LINE を1画面で）
//   ・v_customers（会員 ∪ LINE友だち）を種別・状態・LINE公式アカウントで絞り込み。
//   ・会員行は詳細（別ウィンドウ）へ、LINE行は名寄せ（Matching）へ導線。
//   ・統合済み(merged)の子は既定で隠し、必要なときだけ表示する。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { Customer, CustomerKind } from "../lib/models";
import { CUSTOMER_KIND_LABEL } from "../lib/models";
import { fetchCustomers } from "../lib/customers";
import { fetchLineAccounts } from "../lib/lineAccounts";
import type { LineAccount } from "../lib/models";
import { openChildWindow } from "../lib/childWindow";
import { useRoute } from "../hooks/useRoute";

type KindTab = CustomerKind | "all";
const KIND_TABS: { key: KindTab; label: string }[] = [
  { key: "all",    label: "すべて" },
  { key: "member", label: "会員" },
  { key: "line",   label: "LINE" },
];

export function CustomersView() {
  const route = useRoute();
  const [rows, setRows]         = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [kind, setKind]         = useState<KindTab>("all");
  const [accountId, setAccountId] = useState<number | "all">("all");
  const [showMerged, setShowMerged] = useState(false);
  const [kw, setKw]             = useState("");

  const load = async () => {
    setLoading(true);
    setRows(await fetchCustomers({ kind, status: "all" }));
    setLoading(false);
  };
  useEffect(() => { load().catch(() => setLoading(false)); /* eslint-disable-next-line */ }, [kind]);
  useEffect(() => { fetchLineAccounts().then(setAccounts).catch(() => setAccounts([])); }, []);

  const accountName = (id: number | null) =>
    id == null ? "" : (accounts.find((a) => a.id === id)?.name ?? `#${id}`);

  const view = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return rows.filter((c) => {
      if (accountId !== "all" && c.lineAccountId !== accountId) return false;
      if (!showMerged && c.status === "merged") return false;
      if (k && !(c.displayName.toLowerCase().includes(k) || c.email.toLowerCase().includes(k) || c.phone.includes(k))) return false;
      return true;
    });
  }, [rows, accountId, showMerged, kw]);

  const counts = useMemo(() => ({
    member: rows.filter((c) => c.dataKind === "member").length,
    line:   rows.filter((c) => c.dataKind === "line").length,
  }), [rows]);

  const openMember = (id: number | null) => { if (id != null) openChildWindow(`/ops/members/${id}`, `member-${id}`); };

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-extrabold text-gray-800">顧客一覧</h1>
        <span className="text-[11px] text-gray-400">会員・LINEをデータ種別で横断管理</span>
      </div>
      <p className="text-[12.5px] text-gray-500 mb-4">
        会員 {counts.member} 件 ／ LINE {counts.line} 件。LINEは公式アカウント単位。名寄せ（統合）は「LINE ＞ 名寄せ」で行います。
      </p>

      {/* 種別タブ */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {KIND_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setKind(t.key)}
            className={`text-[12.5px] font-bold rounded-lg px-3 py-1.5 border ${
              kind === t.key ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
            {t.label}
          </button>
        ))}
        <span className="mx-1 w-px h-5 bg-gray-200" />
        <select value={accountId === "all" ? "" : accountId}
          onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "all")}
          className="text-[12.5px] border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
          <option value="">LINE公式：すべて</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || `#${a.id}`}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-gray-600 ml-1">
          <input type="checkbox" checked={showMerged} onChange={(e) => setShowMerged(e.target.checked)} className="w-4 h-4 accent-red-600" />
          統合済みも表示
        </label>
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="氏名・メール・電話で検索"
          className="ml-auto text-[12.5px] border border-gray-200 rounded-lg px-3 py-1.5 bg-white min-w-[200px]" />
        <button type="button" onClick={load} className="text-[11px] font-bold text-gray-500 border border-gray-200 rounded-md px-2 py-1.5">更新</button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">読み込み中…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11.5px]">
                <th className="w-20 px-3 py-2 text-left font-semibold">種別</th>
                <th className="px-3 py-2 text-left font-semibold">氏名 / 表示名</th>
                <th className="px-3 py-2 text-left font-semibold">メール</th>
                <th className="w-32 px-3 py-2 text-left font-semibold">電話</th>
                <th className="w-40 px-3 py-2 text-left font-semibold">LINE公式</th>
                <th className="w-24 px-3 py-2 text-left font-semibold">状態</th>
                <th className="w-20 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-[12.5px]">該当する顧客がありません。</td></tr>
              )}
              {view.map((c, i) => (
                <tr key={`${c.dataKind}-${c.memberId ?? ""}-${c.friendId ?? ""}-${i}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 border ${
                      c.dataKind === "member" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                      {CUSTOMER_KIND_LABEL[c.dataKind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-800">{c.displayName || <span className="text-gray-300">（未設定）</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{c.email || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{c.phone || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{c.dataKind === "line" ? accountName(c.lineAccountId) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">
                    {c.status === "merged"
                      ? <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">統合済</span>
                      : c.dataKind === "line" && c.memberId == null
                        ? <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 border border-gray-200">未連携</span>
                        : <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">通常</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.dataKind === "member"
                      ? <button onClick={() => openMember(c.memberId)} className="text-[12px] font-bold text-red-600 hover:text-red-800">詳細</button>
                      : c.memberId != null
                        ? <button onClick={() => openMember(c.memberId)} className="text-[12px] font-bold text-red-600 hover:text-red-800">会員へ</button>
                        : <button onClick={() => route.go("line-match")} className="text-[12px] font-bold text-emerald-700 hover:text-emerald-900">名寄せ</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
