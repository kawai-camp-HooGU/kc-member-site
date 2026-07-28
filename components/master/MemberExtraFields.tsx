"use client";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import type { MemberMemo, MemoTitle } from "../../lib/models";
import { PREFECTURES } from "../../lib/members";
import { activeMemoTitles, memoTitleName } from "../../lib/memoTitles";
import { AttrTable } from "./AttrTable";
import { FIELD_INPUT } from "../../lib/constants";
interface Props {
  tree: AttrNode[];
  index: AttrIndex;
  prefecture: string;  onPref: (v: string) => void;
  attrIds: number[];   onAttrIds: (ids: number[]) => void;
  memos: MemberMemo[]; onMemos: (m: MemberMemo[]) => void;
  memoTitles: MemoTitle[];
  /** 都道府県欄を隠す（会員以外＝LINE顧客などで使用） */
  hidePrefecture?: boolean;
}

import { fmtJst } from "../../lib/dateFmt";
const nowStr = () => fmtJst(new Date().toISOString());
const fmt = (s: string) => fmtJst(s);
const inputCls = FIELD_INPUT;

// メンバー編集モーダルに差し込む追加項目（都道府県・属性・メモ明細）
export function MemberExtraFields(p: Props) {
  const updateMemo = (i: number, patch: Partial<MemberMemo>) =>
    p.onMemos(p.memos.map((mo, idx) => idx === i ? { ...mo, ...patch, updatedAt: nowStr() } : mo));
  const addMemo = () => p.onMemos([...p.memos, { titleId: null, body: "", source: { kind: "manual" }, updatedAt: nowStr() }]);
  const delMemo = (i: number) => p.onMemos(p.memos.filter((_, idx) => idx !== i));

  return (
    <>
      {!p.hidePrefecture && (
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">都道府県</label>
          <select className={`${inputCls} bg-white`} value={p.prefecture} onChange={(e) => p.onPref(e.target.value)}>
            <option value="">（未選択）</option>
            {PREFECTURES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">属性ABC <span className="text-gray-400 font-normal">顧客詳細画面と同じ表形式</span></label>
        <AttrTable tree={p.tree} index={p.index} value={p.attrIds} onChange={p.onAttrIds} />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">メモ <span className="text-gray-400 font-normal">タイトル（マスタ選択）・登録元・本文</span></label>
        <div className="space-y-2.5">
          {p.memos.map((mo, i) => {
            const isForm = mo.source?.kind === "form";
            const opts = activeMemoTitles(p.memoTitles);
            const curName = memoTitleName(p.memoTitles, mo.titleId);
            return (
            <div key={i} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                <select className={`${inputCls} bg-white flex-1 min-w-[160px]`} value={mo.titleId ?? ""}
                  onChange={(e) => updateMemo(i, { titleId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">（タイトルを選択）</option>
                  {opts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {mo.titleId != null && !opts.some((t) => t.id === mo.titleId) && curName && (
                    <option value={mo.titleId}>{curName}（無効）</option>
                  )}
                </select>
                {isForm ? (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap max-w-[200px] truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                    {(mo.source as { formName: string }).formName || "フォーム"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-1 bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    手動登録
                  </span>
                )}
                <span className="text-[10.5px] text-gray-400 whitespace-nowrap">更新日時：{fmt(mo.updatedAt)}</span>
                <button type="button" className="text-red-500 text-xs whitespace-nowrap" onClick={() => delMemo(i)}>削除</button>
              </div>
              <textarea className={`${inputCls} min-h-[52px] resize-y`} value={mo.body} placeholder="メモ本文"
                onChange={(e) => updateMemo(i, { body: e.target.value })} />
            </div>
          );})}
        </div>
        <button type="button" onClick={addMemo}
          className="w-full mt-2 py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
          ＋ メモ明細を追加
        </button>
      </div>
    </>
  );
}
