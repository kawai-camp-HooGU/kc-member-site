"use client";
import { useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import type { ContentItem } from "../../lib/models";
import { GENRE_LABEL, GENRE_PILL, CONTENT_SAMPLE } from "./contentData";

// コンテンツ設定（管理者・リーダー）：登録・ジャンル・公開対象メンバーの定義
export function ContentSettingsView() {
  const { members } = useMaster();
  const [rows, setRows] = useState<ContentItem[]>(CONTENT_SAMPLE.map((c) => ({ ...c })));
  const [q, setQ] = useState("");
  const list = rows.filter((r) => r.title.includes(q));
  const toggle = (id: number) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, published: !r.published } : r));
  const memberCount = (members || []).length;
  return (
    <div>
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-800">
        <span className="leading-none">⚙</span>
        <p className="leading-relaxed m-0">コンテンツの登録・ジャンル分類・<b className="text-red-600">公開対象メンバーの定義</b>を行います（管理者・リーダーのみ）。対象は「全員」または<b>メンバーマスタ</b>から個別選択できます。</p>
      </div>
      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <button className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700">＋ コンテンツを追加</button>
        <button className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-bold hover:border-gray-300">ジャンル管理</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで検索…"
          className="ml-auto border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:border-red-400" />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50">
              <th className="px-4 py-3 font-semibold text-[11.5px]">タイトル</th>
              <th className="px-4 py-3 font-semibold text-[11.5px]">ジャンル</th>
              <th className="px-4 py-3 font-semibold text-[11.5px]">公開対象メンバー</th>
              <th className="px-4 py-3 font-semibold text-[11.5px]">更新日</th>
              <th className="px-4 py-3 font-semibold text-[11.5px] text-center">公開</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-4 py-3">
                  <div className="font-bold text-gray-800">{r.title}</div>
                  <div className="text-[11px] text-gray-400">{GENRE_LABEL[r.genre]} · {r.meta}</div>
                </td>
                <td className="px-4 py-3"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${GENRE_PILL[r.genre]}`}>{GENRE_LABEL[r.genre]}</span></td>
                <td className="px-4 py-3">
                  {r.target === "all"
                    ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-neutral-900 text-white">全員</span>
                    : <span className="flex gap-1 flex-wrap">{r.target.map((t, i) => <span key={i} className="text-[11px] bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">{t}</span>)}</span>}
                </td>
                <td className="px-4 py-3 text-gray-500">{r.date || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggle(r.id)} aria-label="公開切替"
                    className={`w-9 h-5 rounded-full relative inline-block align-middle transition-colors ${r.published ? "bg-green-500" : "bg-gray-300"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${r.published ? "right-0.5" : "left-0.5"}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-right"><button className="text-xs font-semibold text-gray-500 hover:text-red-600">編集</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">※「公開対象メンバー」＝メンバーマスタ（{memberCount}名）と連動。ジャンル（動画／資料・ファイル／リンク集）がコンテンツ画面のタブに対応します。</p>
    </div>
  );
}
