"use client";
// ============================================================
// 配信停止リスト（メール）管理画面
//   一斉配信・シナリオ配信のメール送信時に照合され、対象アドレスはスキップされる。
//   本人の停止（メール内リンク）と、運営の手動追加/解除の両方を一覧管理する。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSuppressions, addSuppression, removeSuppression } from "../lib/suppression";
import type { Suppression } from "../lib/suppression";
import { useConfirm } from "../components/common/ConfirmProvider";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SuppressionView() {
  const [items, setItems] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirm = useConfirm();

  const reload = useCallback(() => { fetchSuppressions().then((d) => { setItems(d); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? items.filter((s) => s.email.includes(k) || s.reason.toLowerCase().includes(k)) : items;
  }, [items, q]);

  const add = async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setMsg({ ok: false, text: "正しいメールアドレスを入力してください" }); return; }
    setBusy(true); setMsg(null);
    const ok = await addSuppression(e, reason.trim() || "手動追加");
    setBusy(false);
    if (ok) { setEmail(""); setReason(""); setMsg({ ok: true, text: "配信停止に追加しました" }); reload(); }
    else setMsg({ ok: false, text: "追加に失敗しました" });
  };

  const remove = async (s: Suppression) => {
    if (!(await confirm({ title: "配信停止を解除", message: `${s.email} への配信を再開しますか？`, confirmLabel: "解除する" }))) return;
    if (await removeSuppression(s.id)) reload();
  };

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col gap-4">
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">配信停止リスト</h1>
        <span className="text-xs text-gray-400">一斉配信・シナリオ配信のメールはここに登録されたアドレスへ送信されません</span>
      </div>

      {/* 手動追加 */}
      <div className="shrink-0 bg-white border border-gray-200 rounded-xl p-3 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="text-[11px] font-bold text-gray-500 block mb-1">メールアドレス</label>
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="stop@example.com" />
        </div>
        <div className="w-[220px]">
          <label className="text-[11px] font-bold text-gray-500 block mb-1">理由（任意）</label>
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="手動追加 / バウンス など" />
        </div>
        <button onClick={add} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">＋ 追加</button>
        {msg && <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
      </div>

      <div className="flex-1 min-h-0 flex flex-col border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="shrink-0 flex gap-2 items-center px-4 py-3 border-b border-gray-100">
          <input className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="メール・理由で絞り込み" />
          <span className="text-[11px] text-gray-400 ml-auto">{shown.length} 件</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 bg-gray-50 sticky top-0">
                <th className="px-4 py-2.5 font-medium">メールアドレス</th>
                <th className="px-4 py-2.5 font-medium">理由</th>
                <th className="px-4 py-2.5 font-medium">登録日時</th>
                <th className="px-4 py-2.5 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">読み込み中...</td></tr>}
              {!loading && shown.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">配信停止のアドレスはありません。</td></tr>}
              {shown.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-800 break-all">{s.email}</td>
                  <td className="px-4 py-2.5 text-gray-500">{s.reason || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{fmt(s.createdAt)}</td>
                  <td className="px-4 py-2.5"><button onClick={() => remove(s)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">解除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
