"use client";
// ============================================================
// リスト管理：マージ（複数のリストを1つに統合する）
//
//   ⚠️ 統合元のレコードは**消さない**。統合先へコピーしたうえで、
//      統合元のリストをアーカイブするだけ（取り違えても解除で戻せる）。
//   ⚠️ 実行前に「何件入って何件が重複で入らないか」を必ず見せる。
//      見積もりは件数キャッシュ由来の上限値であり、実際の重複数は
//      実行してみないと確定しない旨も明示する。
// ============================================================
import { useMemo, useRef, useState } from "react";
import { Icon } from "../common/Icon";
import type { ContactList } from "../../lib/models";
import { runMerge, validateMerge, mergeSourceTotal } from "../../lib/listMerge";
import type { MergeProgress, MergeResult } from "../../lib/listMerge";

export interface ListMergeModalProps {
  /** 統合先（画面で選択中のリスト） */
  dest: ContactList;
  /** 選択候補（統合先・論理削除は呼び出し側で除外済みでもよい） */
  lists: ContactList[];
  onClose: () => void;
  onDone: (result: MergeResult) => void;
}

export function ListMergeModal({ dest, lists, onClose, onDone }: ListMergeModalProps) {
  const [sourceIds, setSourceIds] = useState<number[]>([]);
  const [archiveSources, setArchiveSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const candidates = useMemo(
    () => lists.filter((l) => l.id !== dest.id && !l.isDeleted),
    [lists, dest.id],
  );
  const sources = useMemo(
    () => candidates.filter((l) => sourceIds.includes(l.id)),
    [candidates, sourceIds],
  );

  const plan = { dest, sources, archiveSources };
  const invalid = validateMerge(plan);
  const total = mergeSourceTotal(sources);

  const toggle = (id: number) =>
    setSourceIds((cur) => (cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id]));

  const start = async () => {
    setBusy(true);
    setConfirming(false);
    abortRef.current = { aborted: false };
    setProgress({ done: 0, total, current: sources[0]?.name ?? "" });
    const res = await runMerge(plan, setProgress, abortRef.current);
    setBusy(false);
    setProgress(null);
    onDone(res);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[60] p-4"
      onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 bg-[#3f3f46] text-white">
          <Icon name="layers" size={15} />
          <span className="text-[13px] font-bold">リストを統合（マージ）</span>
          <span className="ml-auto text-[10.5px] text-gray-300 truncate max-w-[45%]">統合先：{dest.name}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 mb-3">
            <p className="text-[11px] text-gray-700 leading-relaxed">
              選んだリストのレコードを <b>「{dest.name}」へコピー</b>します。
              <b>統合元のレコードは消しません。</b>既に統合先にある宛先（メール／電話）は重複として入りません。
            </p>
          </div>

          <p className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">
            統合元のリストを選ぶ（複数可）
          </p>

          {candidates.length === 0 ? (
            <p className="text-[11.5px] text-gray-400 py-6 text-center">統合できる他のリストがありません。</p>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-[38dvh] overflow-auto">
              {candidates.map((l) => {
                const on = sourceIds.includes(l.id);
                return (
                  <label key={l.id}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${on ? "bg-red-50/60" : "hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(l.id)} />
                    <span className="text-[12px] text-gray-800 truncate flex-1">{l.name}</span>
                    {l.isArchived && (
                      <span className="text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-gray-200 text-gray-600 shrink-0">
                        アーカイブ
                      </span>
                    )}
                    <span className="text-[10.5px] text-gray-400 shrink-0">
                      {l.entryCount.toLocaleString()} 件
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {sources.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mt-3">
              <div className="flex gap-4 flex-wrap text-[12px] mb-2">
                <span>統合元 <b>{sources.length}</b> リスト</span>
                <span>移す候補 <b className="text-base">{total.toLocaleString()}</b> 件</span>
                <span className="text-gray-500">統合後の上限 {(dest.entryCount + total).toLocaleString()} 件</span>
              </div>
              <p className="text-[10px] text-gray-400">
                ⚠️ 実際に入る件数は重複を除いた分になります（重複数は実行してみないと確定しません）。
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input type="checkbox" checked={archiveSources} disabled={busy}
              onChange={(e) => setArchiveSources(e.target.checked)} />
            <span className="text-[12px] text-gray-700">統合後、統合元のリストをアーカイブする</span>
          </label>
          <p className="text-[10px] text-gray-400 mt-1 ml-6">
            アーカイブすると配信先に選べなくなります。レコードと履歴は残るので、いつでも解除できます。
          </p>

          {busy && progress && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 mt-3">
              <p className="text-[11.5px] text-gray-700 mb-1.5">
                統合中… {progress.done.toLocaleString()} / {progress.total.toLocaleString()} 件
                <span className="text-gray-400 ml-2 truncate">（{progress.current}）</span>
              </p>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-red-500 transition-[width]"
                  style={{ width: `${progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                この画面を閉じずにお待ちください。中断してもここまでの分は統合先に残ります。
              </p>
            </div>
          )}

          {confirming && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 mt-3">
              <p className="text-[11.5px] text-red-800 font-bold mb-1">この内容で統合します</p>
              <p className="text-[11px] text-red-800 leading-relaxed">
                {sources.map((s) => `「${s.name}」`).join("")} の <b>{total.toLocaleString()} 件</b>を
                「{dest.name}」へコピーします。
                {archiveSources && <> 統合元 {sources.length} リストは<b>アーカイブ</b>されます。</>}
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          {busy ? (
            <button onClick={() => { abortRef.current.aborted = true; }}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
              中断する
            </button>
          ) : (
            <button onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
              キャンセル
            </button>
          )}
          <span className="ml-auto text-[10.5px] text-gray-400">{!busy && invalid}</span>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} disabled={busy || invalid !== ""}
              className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              内容を確認
            </button>
          ) : (
            <button onClick={start} disabled={busy}
              className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              統合を実行する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
