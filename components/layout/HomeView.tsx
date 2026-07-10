"use client";
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import { fetchNews, visibleNews } from "../../lib/news";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { NewsItem, NewsCategory } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";

interface Props { onOpen?: (k: string) => void }

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ", cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス", cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント", cls: "bg-emerald-50 text-emerald-600" },
};
const linkify = (t: string) => (t || "").replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");
const bodyHtml = (n: NewsItem) => n.bodyMode === "html" ? n.bodyHtml : linkify(n.bodyText);
const fmt = (s: string) => (s ? s.replace("T", " ") : "—");

export function HomeView({ onOpen }: Props) {
  const { members, permission, can } = useMaster();
  const name = permission.myName || "ようこそ";
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(() => members.find((m) => m.id === permission.myId)?.attrIds ?? [], [members, permission.myId]);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    (async () => {
      try { const [n, t] = await Promise.all([fetchNews(), loadAttributeTree()]); setNews(n); setTree(t); }
      catch (e) { console.error("お知らせ読込エラー:", e); }
    })();
  }, []);

  const list = useMemo(() => visibleNews(news, myAttrs, index, seeAll), [news, myAttrs, index, seeAll]);
  const detail = detailId != null ? news.find((n) => n.id === detailId) ?? null : null;

  const cards: { key: string; label: string; jp: string; desc: string; icon: string; feature?: string }[] = [
    { key: "dashboard", label: "Dashboard", jp: "ダッシュボード", desc: "全体の状況を確認", icon: "▤", feature: "dashboard" },
    { key: "kanban",    label: "Board",     jp: "カンバン",       desc: "タスクをボードで管理", icon: "▦", feature: "kanban" },
    { key: "content",   label: "Content",   jp: "コンテンツ",     desc: "資料・動画・記事", icon: "▷", feature: "content" },
    { key: "chat",      label: "Chat",      jp: "チャット",       desc: "メンバーと連絡", icon: "💬", feature: "chat" },
  ];
  const shown = cards.filter((c) => !c.feature || can(c.feature));

  // ── お知らせ詳細 ──
  if (detail) {
    return (
      <div>
        <button onClick={() => setDetailId(null)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">← お知らせ一覧へ戻る</button>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {detail.important && <span className="text-[10.5px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">重要</span>}
            <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${CATS[detail.category].cls}`}>{CATS[detail.category].label}</span>
          </div>
          <h1 className="text-2xl font-extrabold mb-1.5">{detail.title}</h1>
          <p className="text-xs text-gray-400 mb-5">公開日時：{fmt(detail.publishedAt)}</p>
          <div className="text-[15px] leading-8 text-gray-700 content-rich" dangerouslySetInnerHTML={{ __html: bodyHtml(detail) }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-2xl px-6 py-7 mb-6 text-white" style={{ background: "linear-gradient(135deg,#dc2626,#7f1d1d)" }}>
        <p className="text-xs opacity-80 m-0">KAWAI CAMP</p>
        <h1 className="text-2xl font-extrabold mt-1 mb-1">こんにちは、{name} さん</h1>
        <p className="text-sm opacity-90 m-0">新着のお知らせを確認しましょう。</p>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-extrabold text-gray-800 m-0">📢 お知らせ</h2>
        <span className="text-xs text-gray-400">{list.length} 件</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-8">
        {list.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">お知らせはありません</div>
          : list.map((n, i) => (
            <div key={n.id} onClick={() => setDetailId(n.id)} className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{n.title}</div>
                <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-1">
                  {n.important && <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">重要</span>}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CATS[n.category].cls}`}>{CATS[n.category].label}</span>
                  <span>{n.publishedAt ? n.publishedAt.slice(0, 10) : ""}</span>
                </div>
              </div>
              <span className="text-gray-300 shrink-0">›</span>
            </div>
          ))}
      </div>

      {shown.length > 0 && (
        <>
          <h2 className="text-base font-extrabold text-gray-800 mb-3">クイックアクセス</h2>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
            {shown.map((c) => (
              <button key={c.key} onClick={() => onOpen && onOpen(c.key)}
                className="text-left bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-gray-300 transition-all">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-base">{c.icon}</span>
                  <span className="text-[15px] font-bold text-gray-800">{c.label}<span className="text-[11px] text-gray-400 ml-1.5">{c.jp}</span></span>
                </div>
                <p className="text-xs text-gray-400 m-0">{c.desc}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
