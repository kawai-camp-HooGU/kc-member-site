"use client";
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import { fetchContentData, canView, toEmbedUrl } from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { ContentPage, CmsContent } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { Icon } from "../common/Icon";

const linkify = (t: string) =>
  (t || "").replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");

function Thumb({ c, big }: { c: CmsContent; big?: boolean }) {
  const h = big ? "h-52" : "h-36";
  if (c.thumbUrl) return <div className={`${h} bg-center bg-cover`} style={{ backgroundImage: `url('${c.thumbUrl}')` }} />;
  if (c.kind === "video") return (
    <div className={`${h} relative flex items-center justify-center`} style={{ background: "linear-gradient(135deg,#17171b,#3a0a0e)" }}>
      <span className="w-12 h-12 rounded-full text-white flex items-center justify-center" style={{ background: "rgba(225,29,42,.92)" }}><Icon name="content" size={22} /></span>
      <span className="absolute left-2 top-2 bg-white/90 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"><Icon name="video" size={12} />動画</span>
    </div>
  );
  if (c.kind === "doc") return (
    <div className={`${h} relative flex items-center justify-center`} style={{ background: "linear-gradient(135deg,#2b2b31,#111)" }}>
      <span className="absolute left-2 top-2 bg-white/90 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"><Icon name="doc" size={12} />資料</span>
      <span className="text-white"><Icon name="doc" size={34} /></span>
    </div>
  );
  return (
    <div className={`${h} flex items-center justify-center`} style={{ background: "linear-gradient(135deg,#e0e7ff,#f1f5f9)" }}>
      <span className="text-indigo-400"><Icon name="article" size={34} /></span>
    </div>
  );
}

export function ContentView() {
  const { members, permission } = useMaster();
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(() => members.find((m) => m.id === permission.myId)?.attrIds ?? [], [members, permission.myId]);

  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageId, setPageId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    (async () => {
      try {
        const [{ pages, contents }, t] = await Promise.all([fetchContentData(), loadAttributeTree()]);
        setPages(pages); setContents(contents); setTree(t);
      } catch (e) { console.error("コンテンツ読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  const visiblePages = useMemo(
    () => pages.filter((p) => seeAll || canView(p.attrIds, p.attrMode, myAttrs, index))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [pages, seeAll, myAttrs, index]
  );
  useEffect(() => {
    if (pageId == null && visiblePages.length) setPageId(visiblePages[0].id);
    if (pageId != null && visiblePages.length && !visiblePages.some((p) => p.id === pageId)) setPageId(visiblePages[0].id);
  }, [visiblePages, pageId]);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;
  if (visiblePages.length === 0) return <p className="text-sm text-gray-400 py-10 text-center">閲覧できるコンテンツページがありません。</p>;

  const detail = detailId != null ? contents.find((c) => c.id === detailId) ?? null : null;

  // ── 詳細画面 ──
  if (detail) {
    const page = pages.find((p) => p.id === detail.pageId);
    return (
      <div>
        <button onClick={() => setDetailId(null)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">← {page?.name ?? "一覧"}へ戻る</button>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <Thumb c={detail} big />
          <div className="p-6">
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${detail.kind === "video" ? "bg-red-50 text-red-600" : detail.kind === "doc" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"}`}>
              {detail.kind === "video" ? "動画" : detail.kind === "doc" ? "資料" : "記事"}
            </span>
            <h2 className="text-xl font-extrabold mt-2.5 mb-2">{detail.name}</h2>
            <p className="text-xs text-gray-400 mb-5">登録日時：{detail.createdAt ? detail.createdAt.replace("T", " ").slice(0, 16) : "—"}</p>

            {detail.kind === "video" && (
              detail.url
                ? <div className="rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
                    <iframe src={toEmbedUrl(detail.url)} title={detail.name}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} />
                  </div>
                : <p className="text-sm text-gray-400">動画URLが未設定です。</p>
            )}

            {detail.kind === "doc" && (
              detail.url
                ? <div>
                    <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 460 }}>
                      <iframe src={detail.url} title={detail.name} style={{ width: "100%", height: "100%", border: 0 }} />
                    </div>
                    <a href={detail.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"><Icon name="external" size={16} /> 新しいタブで開く</a>
                  </div>
                : <p className="text-sm text-gray-400">資料URLが未設定です。</p>
            )}

            {/* 本文：種別に関わらず入力があれば表示（動画/資料は埋め込みの下に説明として表示） */}
            {(detail.noneMode === "html" ? detail.bodyHtml.trim() : detail.bodyText.trim()) && (
              <div className={`text-[15px] leading-8 text-gray-700 content-rich ${detail.kind !== "none" ? "mt-5" : ""}`}
                dangerouslySetInnerHTML={{ __html: detail.noneMode === "html" ? detail.bodyHtml : linkify(detail.bodyText) }} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 一覧（掲載）画面 ──
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0];
  const items = contents.filter((c) => c.pageId === page.id && c.published && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, index)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-5">
        {visiblePages.map((p) => {
          const n = contents.filter((c) => c.pageId === p.id && c.published && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, index))).length;
          const on = p.id === page.id;
          return (
            <button key={p.id} onClick={() => setPageId(p.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${on ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
              {p.abbr || p.name}<span className="text-xs opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="text-center text-gray-300 py-14 text-sm">このページに公開中のコンテンツはありません</div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
          {items.map((c) => (
            <div key={c.id} onClick={() => setDetailId(c.id)} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer relative">
              <Thumb c={c} />
              <div className="p-3.5">
                <div className="text-sm font-bold leading-snug mb-1.5">{c.name}</div>
                <div className="text-[11px] text-gray-400">{c.createdAt ? c.createdAt.slice(0, 10) : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
