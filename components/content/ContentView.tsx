"use client";
import { useState } from "react";
import type { ContentGenre } from "../../lib/models";
import { CONTENT_GENRES, CONTENT_SAMPLE } from "./contentData";

// メンバー向けコンテンツ掲載ページ（ジャンルタブ切替）
export function ContentView() {
  const [genre, setGenre] = useState<ContentGenre>("video");
  const items = CONTENT_SAMPLE.filter((c) => c.genre === genre && c.published);
  return (
    <div>
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-800">
        <span className="leading-none">🔒</span>
        <p className="leading-relaxed m-0">表示されるコンテンツは<b className="text-red-600">メンバーマスタで定義された対象範囲</b>に応じて自動で出し分けられます（あなたに公開されたものだけが並びます）。ジャンルはタブで切替できます。</p>
      </div>
      <div className="flex gap-2 flex-wrap mb-5">
        {CONTENT_GENRES.map((g) => {
          const n = CONTENT_SAMPLE.filter((c) => c.genre === g.key && c.published).length;
          const on = genre === g.key;
          return (
            <button key={g.key} onClick={() => setGenre(g.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${on ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
              <span>{g.icon}</span>{g.label}<span className="text-xs opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {genre === "link" ? (
        <div className="space-y-2.5">
          {items.map((c) => (
            <a key={c.id} href={c.url} className="flex items-center gap-3.5 bg-white border border-gray-200 rounded-xl px-4 py-3.5 hover:shadow-sm transition-shadow">
              <span className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center text-lg shrink-0">{c.licon || "🔗"}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-gray-800 truncate">{c.title}</span>
                <span className="block text-xs text-red-600 truncate">{c.meta}</span>
              </span>
              <span className="ml-auto text-gray-400 text-lg">↗</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
          {items.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
              {c.genre === "video" ? (
                <div className="h-32 relative flex items-center justify-center" style={{ background: "linear-gradient(135deg,#17171b,#3a0a0e)" }}>
                  <span className="w-11 h-11 rounded-full text-white flex items-center justify-center text-lg" style={{ background: "rgba(225,29,42,.92)", paddingLeft: 3 }}>▶</span>
                  <span className="absolute right-2 bottom-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{c.meta}</span>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#2b2b31,#111)" }}>
                  <span className="text-white font-extrabold text-2xl tracking-wide">{c.ext}</span>
                </div>
              )}
              <div className="p-3.5">
                <div className="text-sm font-bold leading-snug mb-1.5">{c.title}</div>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                  {c.badge && <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">{c.badge}</span>}
                  <span>{c.genre === "video" ? c.date : c.meta}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
