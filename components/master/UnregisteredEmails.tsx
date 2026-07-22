"use client";
// ============================================================
// 会員未登録メールアドレス（メンバー一覧 ＞「会員未登録」タブ）
//   フォーム回答・決済情報に出てくるのに、会員マスタに存在しない
//   メールアドレスを1行にまとめて表示し、運営メモを書けるようにする。
//   判定・集計はサーバー（/api/ops/unregistered-emails）が行う。
//
//   ⚠️ 会員登録アクションのあるフォームは回答と同時に会員化されるため、
//      ここに残るのは「会員化されなかった人」＝フォローの取りこぼし候補。
//   ⚠️ 「登録日時」は最終接触（lastAt）を出す。いちばん新しい動きを基準に
//      上から潰していく運用のため（初回は詳細の記録で追える）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/apiClient";
import { errMessage } from "../../lib/errors";
import { CARD, FIELD_INPUT, STATE_CHIP } from "../../lib/constants";
import type { UnregisteredEmail } from "../../lib/models";

const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");

interface Props {
  /** 件数をタブのバッジへ返す */
  onCount?: (n: number) => void;
}

export function UnregisteredEmails({ onCount }: Props) {
  const [items, setItems] = useState<UnregisteredEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "form" | "payment">("all");
  const [detail, setDetail] = useState<UnregisteredEmail | null>(null);
  /** 保存完了を数秒だけ出す（保存ボタンを置かない代わりの手応え） */
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/api/ops/unregistered-emails", { method: "GET" });
      const json = (await res.json()) as { items?: UnregisteredEmail[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setItems(json.items ?? []);
      onCount?.(json.items?.length ?? 0);
    } catch (e) {
      setErr(errMessage(e));
    }
    setLoading(false);
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  /** メモの保存。入力欄から離れたときだけ呼ぶ（打鍵ごとには送らない） */
  const saveNote = async (email: string, note: string) => {
    const cur = items.find((i) => i.email === email);
    if (!cur || cur.note === note) return;
    setItems((prev) => prev.map((i) => (i.email === email ? { ...i, note } : i)));
    try {
      const res = await apiFetch("/api/ops/unregistered-notes", { method: "PUT", body: { email, note } });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "メモの保存に失敗しました");
      }
      setSaved(email);
      window.setTimeout(() => setSaved((s) => (s === email ? null : s)), 2000);
    } catch (e) {
      setErr(errMessage(e));
      // 失敗したら画面を元に戻す（保存できたように見せない）
      setItems((prev) => prev.map((i) => (i.email === email ? { ...i, note: cur.note } : i)));
    }
  };

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((it) => {
      if (only === "form" && it.formCount === 0) return false;
      if (only === "payment" && it.paymentCount === 0) return false;
      if (!kw) return true;
      return `${it.email} ${it.name} ${it.origins.join(" ")} ${it.note}`.toLowerCase().includes(kw);
    });
  }, [items, q, only]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${FIELD_INPUT} max-w-[240px]`} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="メール・氏名・由来・メモで絞り込み" />
        <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5">
          {([["all", "すべて"], ["form", "フォーム"], ["payment", "決済あり"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k}
              className={`px-2.5 py-1 rounded-md text-[12px] font-semibold ${
                only === k ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => void load()}
          className="text-[12px] font-bold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
          再読み込み
        </button>
      </div>

      <div className={`${CARD} px-4 py-3`}>
        <p className="text-[11.5px] text-gray-500 leading-relaxed m-0">
          フォーム回答・決済情報に出てくるのに、<b>会員マスタに登録が無い</b>メールアドレスです。
          同じメールは1行にまとめ、<b>いちばん新しい動き</b>を登録日時として表示します。
          会員登録されるとこの一覧から自動的に消えます（メモは残ります）。
        </p>
      </div>

      {err && <p className="text-[12.5px] text-red-600">{err}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-auto" style={{ maxHeight: "60vh" }}>
        <div className="px-4 pt-3 pb-2 text-xs text-gray-400">
          {rows.length} 件 / 全 {items.length} 件
        </div>
        {loading ? (
          <div className="text-center text-gray-300 py-8 text-sm">読み込み中...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-300 py-8 text-sm">
            {items.length === 0 ? "未登録のメールアドレスはありません" : "該当する行がありません"}
          </div>
        ) : (
          <table className="w-full text-[12.5px]" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "13%" }} /><col style={{ width: "12%" }} />
              <col style={{ width: "20%" }} /><col style={{ width: "21%" }} /><col /><col style={{ width: 56 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="tbl-head text-left">
                <th className="px-3 py-2.5">登録日時</th>
                <th className="px-3 py-2.5">氏名</th>
                <th className="px-3 py-2.5">どこで（由来）</th>
                <th className="px-3 py-2.5">メールアドレス</th>
                <th className="px-3 py-2.5">メモ</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.email}
                  /* 入金があるのに会員化されていない行だけ地を敷く＝最優先の対応対象 */
                  className={`border-t border-gray-100 align-middle ${
                    it.paymentCount > 0 ? "bg-red-50/40" : "hover:bg-gray-50/60"}`}>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmt(it.lastAt)}</td>
                  <td className="px-3 py-2.5 text-gray-700 truncate">{it.name || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {it.paymentCount > 0 && <span className={`${STATE_CHIP.alert} shrink-0`}>決済</span>}
                      <span className="text-gray-700 truncate">{it.origins[0] ?? "—"}</span>
                      {it.origins.length > 1 && (
                        <span className="text-[10px] text-gray-400 shrink-0">他{it.origins.length - 1}件</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-gray-800 truncate">{it.email}</td>
                  <td className="px-3 py-2.5">
                    <div className="relative">
                      <input className={FIELD_INPUT} defaultValue={it.note} placeholder="メモを入力"
                        onBlur={(e) => void saveNote(it.email, e.target.value)} />
                      {saved === it.email && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-600">
                          保存しました
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button type="button" onClick={() => setDetail(it)}
                      className="text-[11px] font-bold text-gray-400 hover:text-gray-700">詳細</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <DetailModal it={items.find((i) => i.email === detail.email) ?? detail}
          onClose={() => setDetail(null)}
          onSaveNote={(note) => void saveNote(detail.email, note)} />
      )}
    </div>
  );
}

// ── 詳細 ──────────────────────────────────────────────────────
/** 同じメールアドレスの回答・決済を時系列で並べ、いつどこから来た人かを追えるようにする */
function DetailModal({
  it, onClose, onSaveNote,
}: { it: UnregisteredEmail; onClose: () => void; onSaveNote: (note: string) => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#3f3f46]">
          <span className="text-[12.5px] font-bold text-white tracking-wide truncate">{it.email}</span>
          <span className="flex-1" />
          {it.paymentCount > 0 && (
            <span className={STATE_CHIP.alert}>決済 {it.paymentCount}件 ¥{it.amount.toLocaleString()}</span>
          )}
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white text-sm px-1">✕</button>
        </div>
        <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
          <div>
            <span className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">氏名（回答時の入力）</span>
            <div className="text-[13px] text-gray-800">{it.name || "—"}</div>
          </div>
          <div>
            <span className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">これまでの記録</span>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
              {it.events.map((ev, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <span className="text-gray-500 w-[110px] shrink-0">{fmt(ev.at)}</span>
                  <span className={`${ev.kind === "payment" ? STATE_CHIP.alert : "text-[10px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-600"} shrink-0`}>
                    {ev.kind === "payment" ? "決済" : "フォーム"}
                  </span>
                  <span className="text-gray-700 flex-1 truncate">{ev.label}</span>
                  {ev.amount > 0 && (
                    <span className="text-gray-800 font-bold shrink-0">¥{ev.amount.toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">
              メモ
              {it.noteBy && (
                <span className="ml-2 font-normal text-gray-300">最終更新：{it.noteBy} {fmt(it.noteAt)}</span>
              )}
            </span>
            <textarea className={`${FIELD_INPUT} min-h-[80px]`} defaultValue={it.note}
              placeholder="メモを入力" onBlur={(e) => onSaveNote(e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}
