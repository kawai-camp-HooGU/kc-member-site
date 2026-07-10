"use client";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import type { MemberMemo } from "../../lib/models";
import { PREFECTURES } from "../../lib/members";
import { AttrCascadePicker } from "./AttrCascadePicker";

interface Props {
  tree: AttrNode[];
  index: AttrIndex;
  prefecture: string;  onPref: (v: string) => void;
  attrIds: number[];   onAttrIds: (ids: number[]) => void;
  memos: MemberMemo[]; onMemos: (m: MemberMemo[]) => void;
}

const nowStr = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

// メンバー編集モーダルに差し込む追加項目（都道府県・属性・メモ明細）
export function MemberExtraFields(p: Props) {
  const updateMemo = (i: number, patch: Partial<MemberMemo>) =>
    p.onMemos(p.memos.map((mo, idx) => idx === i ? { ...mo, ...patch, updatedAt: nowStr() } : mo));
  const addMemo = () => p.onMemos([...p.memos, { title: "", body: "", updatedAt: nowStr() }]);
  const delMemo = (i: number) => p.onMemos(p.memos.filter((_, idx) => idx !== i));

  return (
    <>
      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">都道府県</label>
        <select className={`${inputCls} bg-white`} value={p.prefecture} onChange={(e) => p.onPref(e.target.value)}>
          <option value="">（未選択）</option>
          {PREFECTURES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">属性ABC <span className="text-gray-400 font-normal">カスケードで複数選択可</span></label>
        <AttrCascadePicker tree={p.tree} index={p.index} value={p.attrIds} onChange={p.onAttrIds} />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">メモ <span className="text-gray-400 font-normal">タイトル・本文・更新日時の明細</span></label>
        <div className="space-y-2.5">
          {p.memos.map((mo, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-center gap-2.5 mb-1.5">
                <input className={`${inputCls} flex-1`} value={mo.title} placeholder="タイトル"
                  onChange={(e) => updateMemo(i, { title: e.target.value })} />
                <span className="text-[10.5px] text-gray-400 whitespace-nowrap">更新日時：{fmt(mo.updatedAt)}</span>
                <button type="button" className="text-red-500 text-xs whitespace-nowrap" onClick={() => delMemo(i)}>削除</button>
              </div>
              <textarea className={`${inputCls} min-h-[52px] resize-y`} value={mo.body} placeholder="メモ本文"
                onChange={(e) => updateMemo(i, { body: e.target.value })} />
            </div>
          ))}
        </div>
        <button type="button" onClick={addMemo}
          className="w-full mt-2 py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
          ＋ メモ明細を追加
        </button>
      </div>
    </>
  );
}
