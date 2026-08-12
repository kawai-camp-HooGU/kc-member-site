"use client";
// 名寄せ（案B・要対応キュー）：未連携の友だちを種類別に一括処理する。
//   ・照合エンジン（buildLinkQueue）と連携API（Phase 2）を流用。
//   ・自動連携は照合時に別途行われる。ここは残った「要対応」を人が確定する場。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { useLineAccounts } from "../hooks/useLineAccounts";
import type { LineLinkCategory, LineLinkQueueItem, MergePreview } from "../lib/models";
import { fetchLineLinkQueue, manualLinkLineFriend } from "../lib/line";
import { buildMergePreview } from "../lib/customers";
import { FriendAvatar } from "../components/line/FriendAvatar";
import { LineAccountBar } from "../components/line/LineAccountBar";

const CATS: { key: LineLinkCategory; label: string }[] = [
  { key: "ready",     label: "連携できる（一意一致）" },
  { key: "conflict",  label: "要判断（複数一致・矛盾）" },
  { key: "duplicate", label: "重複の疑い" },
  { key: "name",      label: "氏名候補（手動）" },
];
const matchedLabel = (k: "email" | "phone" | "name") => (k === "email" ? "メール" : k === "phone" ? "電話" : "氏名");

export function LineLinkQueueView() {
  const route = useRoute();
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const [items, setItems] = useState<LineLinkQueueItem[]>([]);
  const [cat, setCat] = useState<LineLinkCategory>("ready");
  const [busy, setBusy] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  // 統合プレビュー（実行前の項目差分）
  const [preview, setPreview] = useState<MergePreview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await fetchLineLinkQueue(accountId));
    setLoading(false);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) if (!dismissed.has(it.friendId)) c[it.category] = (c[it.category] ?? 0) + 1;
    return c;
  }, [items, dismissed]);

  const shown = useMemo(
    () => items.filter((it) => it.category === cat && !dismissed.has(it.friendId)),
    [items, cat, dismissed]
  );

  // 連携（統合）前にプレビューを開く。差分を確認してから確定する。
  const askPreview = async (friendId: number, memberId: number) => {
    setBusy(friendId);
    const p = await buildMergePreview(friendId, memberId);
    setBusy(null);
    if (!p) { await doLink(friendId, memberId); return; }  // 取得できなければ従来どおり即連携
    setPreview(p);
  };
  const doLink = async (friendId: number, memberId: number) => {
    setBusy(friendId);
    const r = await manualLinkLineFriend(friendId, memberId);
    setBusy(null);
    if (!r.ok) { alert(r.error ?? "連携に失敗しました"); return; }
    setPreview(null);
    await load();
  };
  const skip = (friendId: number) => setDismissed((s) => new Set(s).add(friendId));
  const openTalk = (friendId: number) => route.go("line", [friendId]);

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="名寄せ" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 左：カテゴリ */}
      <div className="w-[220px] flex-shrink-0 border-r border-gray-200 bg-white p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-sm font-extrabold">名寄せ 要対応</h1>
          <button onClick={load} className="text-[11px] font-bold text-gray-500 border border-gray-200 rounded-md px-2 py-1">更新</button>
        </div>
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={`w-full text-left text-[12px] font-bold px-3 py-2 rounded-lg mb-1 flex justify-between items-center ${
              cat === c.key ? "bg-emerald-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span>{c.label}</span>
            <span className={`text-[11px] ${cat === c.key ? "text-white/90" : "text-gray-400"}`}>{counts[c.key] ?? 0}</span>
          </button>
        ))}
        <p className="text-[10.5px] text-gray-400 mt-3 px-1">
          自動連携（②③の一意一致）は照合時に完了します。ここは残った要対応の確定作業です。
        </p>
      </div>

      {/* 右：カード */}
      <div className="flex-1 min-w-0 overflow-y-auto p-5 bg-gray-50">
        {loading && <div className="text-sm text-gray-400">読み込み中…</div>}
        {!loading && shown.length === 0 && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
            このカテゴリの要対応はありません。
          </div>
        )}

        {shown.map((it) => {
          const name = it.displayName || it.collectedName || "(名称未取得)";
          const collected = [it.collectedEmail, it.collectedPhone].filter(Boolean).join(" / ");
          const autoCand = it.autoMemberId != null ? it.candidates.find((c) => c.memberId === it.autoMemberId) : null;
          return (
            <div key={it.friendId} className={`bg-white border rounded-2xl p-4 mb-3 ${it.category === "conflict" || it.category === "duplicate" ? "border-amber-200 bg-amber-50/40" : "border-gray-200"}`}>
              <div className="flex items-center gap-3 mb-2">
                <FriendAvatar name={name} seed={String(it.friendId)} size={34} />
                <div className="min-w-0">
                  <div className="font-extrabold text-[14px] truncate">{name} <span className="tag" /></div>
                  <div className="text-[11.5px] text-gray-500 truncate">
                    {it.collectedName && `氏名: ${it.collectedName}　`}{collected || "収集情報なし"}
                  </div>
                </div>
                <button onClick={() => openTalk(it.friendId)} className="ml-auto text-[11.5px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">トークを開く</button>
              </div>

              {/* ready：一意の会員へ1クリック連携 */}
              {it.category === "ready" && autoCand && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <div className="text-[12.5px]">
                    <b>{autoCand.name || "(名称未設定)"}</b> <span className="text-gray-400">#{autoCand.memberId}</span>
                    <span className="text-gray-500 ml-1">（{autoCand.matchedBy.map(matchedLabel).join("・")}一致）</span>
                  </div>
                  <button onClick={() => askPreview(it.friendId, autoCand.memberId)} disabled={busy === it.friendId} className="ml-auto text-[12px] font-bold bg-emerald-600 text-white rounded-md px-3 py-1.5 disabled:opacity-50">統合プレビュー</button>
                </div>
              )}

              {/* conflict / duplicate / name：候補から選ぶ */}
              {(it.category === "conflict" || it.category === "duplicate" || it.category === "name") && (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {it.candidates.map((c) => (
                    <div key={c.memberId} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 text-[12.5px]">
                        <b>{c.name || "(名称未設定)"}</b> <span className="text-gray-400">#{c.memberId}</span>
                        <div className="text-[11px] text-gray-400 truncate">
                          {c.matchedBy.map(matchedLabel).join("・")}一致
                          {c.email && ` ／ ${c.email}`}{c.tel && ` ／ ${c.tel}`}
                          {c.alreadyLinked && " ／ 既に別LINEに連携済み"}
                        </div>
                      </div>
                      <button onClick={() => askPreview(it.friendId, c.memberId)} disabled={busy === it.friendId || c.alreadyLinked} className="ml-auto text-[12px] font-bold border border-emerald-300 text-emerald-700 rounded-md px-3 py-1.5 disabled:opacity-40">統合</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2 flex justify-end">
                <button onClick={() => skip(it.friendId)} className="text-[11.5px] text-gray-400 hover:text-gray-600">保留（一覧から隠す）</button>
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {/* 統合プレビュー（会員=親 ← LINE=子。空いている項目だけ非破壊で補完） */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center md:items-center z-[60] p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100">
              <div className="text-sm font-bold text-gray-800">統合プレビュー</div>
              <div className="text-[11.5px] text-gray-500 mt-0.5">
                会員 <b>{preview.memberName || `#${preview.memberId}`}</b>（親）← LINE <b>{preview.lineDisplayName || "友だち"}</b>（子）。緑＝会員が空なので補完します。
              </div>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-gray-400 text-[11px]">
                    <th className="text-left font-semibold py-1 w-24">項目</th>
                    <th className="text-left font-semibold py-1">会員（現在）</th>
                    <th className="text-left font-semibold py-1">LINEの値</th>
                    <th className="text-left font-semibold py-1 w-20">統合後</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.diffs.map((d) => (
                    <tr key={d.field} className={`border-t border-gray-100 ${d.willFill ? "bg-emerald-50/60" : ""}`}>
                      <td className="py-1.5 font-semibold text-gray-600">{d.label}</td>
                      <td className="py-1.5 text-gray-500">{d.parentValue || "（空）"}</td>
                      <td className="py-1.5 text-gray-700">{d.childValue || "—"}</td>
                      <td className="py-1.5">{d.willFill ? <b className="text-emerald-700">補完</b> : <span className="text-gray-300">維持</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!preview.diffs.some((d) => d.willFill) && (
                <p className="text-[11.5px] text-gray-400 mt-2">補完される項目はありません（LINE識別子の紐づけのみ行われます）。</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setPreview(null)} className="text-[12.5px] font-bold border border-gray-200 rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <button onClick={() => doLink(preview.friendId, preview.memberId)} disabled={busy === preview.friendId}
                className="text-[12.5px] font-bold bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">この内容で統合する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
