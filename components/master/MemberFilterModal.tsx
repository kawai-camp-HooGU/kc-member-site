"use client";
import { useState } from "react";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex, MemberFilter, MemberSort, AttrMode, SortKey, NotifyFilter, LoginFilter, ProgressFilter } from "../../lib/members";
import {
  ATTR_MODE_OPTIONS, NOTIFY_FILTER_OPTIONS, LOGIN_FILTER_OPTIONS, PROGRESS_FILTER_OPTIONS,
  DEFAULT_FILTER, DEFAULT_SORT,
} from "../../lib/members";
import { AttrTable } from "./AttrTable";

interface Props {
  tree: AttrNode[];
  index: AttrIndex;
  filter: MemberFilter;
  sort: MemberSort;
  onApply: (f: MemberFilter, s: MemberSort) => void;
  onClear: () => void;
  onClose: () => void;
}

export function MemberFilterModal({ tree, index, filter, sort, onApply, onClear, onClose }: Props) {
  const [keyword, setKeyword]     = useState(filter.keyword);
  const [tags, setTags]           = useState<number[]>([...filter.tags]);
  const [attrMode, setAttrMode]   = useState<AttrMode>(filter.attrMode);
  const [unlinked, setUnlinked]   = useState(filter.unlinkedOnly);
  const [notify, setNotify]       = useState<NotifyFilter>(filter.notify ?? "all");
  const [login, setLogin]         = useState<LoginFilter>(filter.login ?? "all");
  const [progress, setProgress]   = useState<ProgressFilter>(filter.progress ?? "all");
  const [sortKey, setSortKey]     = useState<SortKey>(sort.key);
  const [sortDir, setSortDir]     = useState<"asc" | "desc">(sort.dir);

  const seg = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded-md ${active ? "bg-white text-red-600 shadow-sm" : "text-gray-500"}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">🔎 抽出条件</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">キーワード <span className="text-gray-400 font-medium">氏名・メール・メモのタイトルを部分一致</span></label>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="氏名・メール・メモのタイトルで検索…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">属性ABC <span className="text-gray-400 font-medium">顧客詳細画面と同じ表形式</span></label>
            <AttrTable tree={tree} index={index} value={tags} onChange={setTags} addLabel="＋ 抽出する属性を追加" />
            <div className="mt-3">
              <label className="text-[11px] font-bold text-gray-500 block mb-1.5">抽出条件</label>
              <select value={attrMode} onChange={(e) => setAttrMode(e.target.value as AttrMode)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
                {ATTR_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">状態</label>
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => setUnlinked((v) => !v)}
                className={`relative w-10 h-[22px] rounded-full transition-colors ${unlinked ? "bg-emerald-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all ${unlinked ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-sm text-gray-700">紐づけ未済（メンバー登録未済）のみ表示</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">
              通知設定 <span className="text-gray-400 font-medium">プッシュ通知の受信可否で絞り込み</span>
            </label>
            <select value={notify} onChange={(e) => setNotify(e.target.value as NotifyFilter)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
              {NOTIFY_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1.5">未登録＝端末を1台も登録していない／通知OFF＝端末はあるが本人が通知を停止中。</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1.5">最終ログイン</label>
              <select value={login} onChange={(e) => setLogin(e.target.value as LoginFilter)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
                {LOGIN_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1.5">コンテンツ視聴</label>
              <select value={progress} onChange={(e) => setProgress(e.target.value as ProgressFilter)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
                {PROGRESS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">視聴率の分母は、その人が属性条件で閲覧できる公開コンテンツ数です。</p>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">並び替え</label>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="inline-flex bg-gray-100 rounded-lg p-1">
                <button type="button" className={seg(sortKey === "createdAt")} onClick={() => setSortKey("createdAt")}>登録日時</button>
                <button type="button" className={seg(sortKey === "name")} onClick={() => setSortKey("name")}>氏名</button>
                <button type="button" className={seg(sortKey === "lastLogin")} onClick={() => setSortKey("lastLogin")}>最終ログイン</button>
                <button type="button" className={seg(sortKey === "progress")} onClick={() => setSortKey("progress")}>視聴率</button>
              </div>
              <div className="inline-flex bg-gray-100 rounded-lg p-1">
                <button type="button" className={seg(sortDir === "asc")} onClick={() => setSortDir("asc")}>昇順</button>
                <button type="button" className={seg(sortDir === "desc")} onClick={() => setSortDir("desc")}>降順</button>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">既定は「登録日時（昇順）」です。</p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
          <button onClick={() => { onClear(); onClose(); }} className="text-sm py-2 px-4 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">クリア</button>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={() => { onApply({ keyword, tags, attrMode, unlinkedOnly: unlinked, notify, login, progress }, { key: sortKey, dir: sortDir }); onClose(); }}
            className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">この条件で抽出</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_FILTER, DEFAULT_SORT };
