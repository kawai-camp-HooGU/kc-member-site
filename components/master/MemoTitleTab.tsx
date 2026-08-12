"use client";
// ============================================================
// 設定 ＞ マスタ管理 ＞ メモタイトル
//
//   メンバーのメモは、ここで登録したタイトルから選択する（フリー入力は廃止）。
//   メモは title_id でこのマスタを参照するため、名称を変えれば既存メモの
//   表示も追従する。使わなくなったタイトルは「無効化」で候補から外す。
// ============================================================
import { useEffect, useState } from "react";
import type { MemoTitle } from "../../lib/models";
import {
  fetchMemoTitles, saveMemoTitle, deleteMemoTitle,
} from "../../lib/memoTitles";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useToast } from "../common/ToastProvider";
import { CARD, FIELD_INPUT } from "../../lib/constants";

const inputCls = FIELD_INPUT;

export function MemoTitleTab() {
  const toast = useToast();
  const [list, setList]       = useState<MemoTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<MemoTitle | null>(null);

  const load = async () => {
    setList(await fetchMemoTitles());
    setLoading(false);
  };
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (list.some((t) => t.name === name)) { toast.error("同じ名前のタイトルが既にあります"); return; }
    const saved = await saveMemoTitle({ id: 0, name, sortOrder: (list.at(-1)?.sortOrder ?? 0) + 1, isActive: true });
    if (!saved) { toast.error("追加に失敗しました"); return; }
    setNewName("");
    setList((l) => [...l, saved]);
    toast.success("タイトルを追加しました");
  };

  const rename = async (t: MemoTitle, name: string) => {
    const next = { ...t, name };
    setList((l) => l.map((x) => (x.id === t.id ? next : x)));
    const saved = await saveMemoTitle(next);
    if (!saved) toast.error("保存に失敗しました");
  };

  const toggleActive = async (t: MemoTitle) => {
    const next = { ...t, isActive: !t.isActive };
    setList((l) => l.map((x) => (x.id === t.id ? next : x)));
    const saved = await saveMemoTitle(next);
    if (saved) toast.success(next.isActive ? "有効にしました" : "無効にしました（新規選択の候補から外れます）");
    else toast.error("保存に失敗しました");
  };

  const remove = async (t: MemoTitle) => {
    setConfirm(null);
    await deleteMemoTitle(t.id);
    setList((l) => l.filter((x) => x.id !== t.id));
    toast.success("削除しました");
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    // 表示順を詰め直して保存
    await Promise.all(next.map((t, idx) => (t.sortOrder !== idx ? saveMemoTitle({ ...t, sortOrder: idx }) : null)).filter(Boolean) as Promise<unknown>[]);
    setList(next.map((t, idx) => ({ ...t, sortOrder: idx })));
  };

  if (loading) return <p className="text-sm text-gray-400 p-4">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-800">メモタイトル</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5">
          メンバーのメモで選べるタイトルを管理します。使わなくなったものは「無効」にすると新規選択の候補から外れます（既存メモの表示は保持）。
        </p>
      </div>

      {/* 追加 */}
      <div className={`${CARD} p-3 flex items-center gap-2`}>
        <input
          className={`${inputCls} flex-1`}
          placeholder="新しいタイトル名（例：電話対応メモ）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!newName.trim()}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 whitespace-nowrap">
          ＋ 追加
        </button>
      </div>

      {/* 一覧 */}
      <div className={`${CARD} overflow-hidden overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-[11.5px]">
              <th className="w-16 px-3 py-2 text-left font-semibold">表示順</th>
              <th className="px-3 py-2 text-left font-semibold">タイトル名</th>
              <th className="w-24 px-3 py-2 text-left font-semibold">状態</th>
              <th className="w-20 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400 text-[12.5px]">タイトルがまだありません。上の欄から追加してください。</td></tr>
            )}
            {list.map((t, i) => (
              <tr key={t.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <div className="flex flex-col leading-none text-gray-400">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="hover:text-gray-700 disabled:opacity-30 text-[11px]">▲</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1}
                      className="hover:text-gray-700 disabled:opacity-30 text-[11px]">▼</button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    className={`${inputCls} w-full ${t.isActive ? "" : "text-gray-400 line-through"}`}
                    value={t.name}
                    onChange={(e) => setList((l) => l.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                    onBlur={(e) => rename(t, e.target.value.trim())}
                  />
                </td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => toggleActive(t)}
                    className={`text-[11px] font-bold rounded-full px-2.5 py-1 border ${
                      t.isActive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                    {t.isActive ? "有効" : "無効"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setConfirm(t)}
                    className="text-[12px] text-red-500 hover:text-red-700">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmDialog
          message={`「${confirm.name}」を削除します。\nこのタイトルを使っている既存メモは、名称の表示が「（不明）」フォールバックになります。\n通常は削除ではなく「無効」を推奨します。`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => remove(confirm)}
        />
      )}
    </div>
  );
}
