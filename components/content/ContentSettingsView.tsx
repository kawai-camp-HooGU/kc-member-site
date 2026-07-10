"use client";
import { useEffect, useMemo, useState } from "react";
import {
  fetchContentData, savePage, deletePage, saveContent, deleteContent, setPublished, toEmbedUrl,
  saveContentOrder, savePageOrder,
} from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex, attrSegs, attrLabel } from "../../lib/members";
import { AttrCascadePicker } from "../master/AttrCascadePicker";
import type { ContentPage, CmsContent, PublishMode } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";

const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const MODE_LABEL: Record<PublishMode, string> = { any: "いずれか含む", all: "すべて含む", exany: "いずれか含むを除外", exall: "すべて含むを除外" };
const KIND_LABEL: Record<string, string> = { video: "動画", doc: "資料", none: "なし（記事）" };
const nowStr = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : nowStr());
const linkify = (t: string) => (t || "").replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

function TargetTags({ attrIds, mode, index }: { attrIds: number[]; mode: PublishMode; index: AttrIndex }) {
  if (!attrIds.length) return <span className="text-gray-400">全員</span>;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="text-[10.5px] text-gray-400">（{MODE_LABEL[mode]}）</span>
      {attrIds.map((id) => {
        const segs = attrSegs(index, id); const last = segs[segs.length - 1] ?? { color: "#9ca3af" };
        return <span key={id} className="text-[10.5px] px-2 py-0.5 rounded-full border" style={{ borderColor: `${last.color}55`, color: last.color, background: `${last.color}0f` }}>{attrLabel(index, id)}</span>;
      })}
    </span>
  );
}

export function ContentSettingsView() {
  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [curPageId, setCurPageId] = useState<number | null>(null);
  const [pageEdit, setPageEdit] = useState<ContentPage | null>(null);
  const [showPages, setShowPages] = useState(false);
  const [cEdit, setCEdit] = useState<CmsContent | null>(null);
  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  const reload = async () => {
    const { pages, contents } = await fetchContentData();
    setPages(pages); setContents(contents);
    setCurPageId((cur) => cur != null && pages.some((p) => p.id === cur) ? cur : (pages[0]?.id ?? null));
  };
  useEffect(() => {
    (async () => {
      try {
        const [{ pages, contents }, t] = await Promise.all([fetchContentData(), loadAttributeTree()]);
        setPages(pages); setContents(contents); setTree(t); setCurPageId(pages[0]?.id ?? null);
      } catch (e) { console.error("コンテンツ読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const sortedPages = [...pages].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const curPage = pages.find((p) => p.id === curPageId) ?? null;
  const items = contents.filter((c) => c.pageId === curPageId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  // 並び替え（コンテンツ：現在ページ内）
  const moveContent = async (idx: number, dir: number) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const arr = [...items];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((c, i) => ({ id: c.id, sortOrder: i }));
    setContents((prev) => prev.map((c) => { const u = updates.find((x) => x.id === c.id); return u ? { ...c, sortOrder: u.sortOrder } : c; }));
    await saveContentOrder(updates);
  };
  // 並び替え（ページ）
  const movePage = async (idx: number, dir: number) => {
    const to = idx + dir;
    if (to < 0 || to >= sortedPages.length) return;
    const arr = [...sortedPages];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((p, i) => ({ id: p.id, sortOrder: i }));
    setPages((prev) => prev.map((p) => { const u = updates.find((x) => x.id === p.id); return u ? { ...p, sortOrder: u.sortOrder } : p; }));
    await savePageOrder(updates);
  };

  const newContent = (): CmsContent => ({
    id: 0, pageId: curPageId ?? 0, name: "", createdAt: "", sortOrder: items.length, published: true,
    kind: "none", url: "", noneMode: "text", bodyText: "", bodyHtml: "", thumbUrl: "", attrMode: "any", attrIds: [],
  });
  const newPage = (): ContentPage => ({ id: 0, name: "", abbr: "", createdAt: "", sortOrder: pages.length, attrMode: "any", attrIds: [] });

  const doSaveContent = async () => {
    if (!cEdit) return;
    if (!cEdit.name.trim()) { alert("コンテンツ名を入力してください"); return; }
    await saveContent(cEdit); setCEdit(null); await reload();
  };
  const doDeleteContent = async () => {
    if (!cEdit?.id) return;
    if (!window.confirm(`「${cEdit.name}」を削除しますか？`)) return;
    await deleteContent(cEdit.id); setCEdit(null); await reload();
  };
  const doSavePage = async () => {
    if (!pageEdit) return;
    if (!pageEdit.name.trim() || !pageEdit.abbr.trim()) { alert("ページ名と略称を入力してください"); return; }
    const id = await savePage(pageEdit); setPageEdit(null); await reload();
    if (id) setCurPageId(id);
  };
  const doDeletePage = async () => {
    if (!pageEdit?.id) return;
    if (contents.some((c) => c.pageId === pageEdit.id)) { alert("コンテンツが残っているため削除できません"); return; }
    if (!window.confirm(`ページ「${pageEdit.name}」を削除しますか？`)) return;
    await deletePage(pageEdit.id); setPageEdit(null); await reload();
  };
  const togglePub = async (c: CmsContent) => {
    await setPublished(c.id, !c.published);
    setContents((prev) => prev.map((x) => x.id === c.id ? { ...x, published: !x.published } : x));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span>⚙</span>
        <p className="leading-relaxed m-0">ここで作成した<b className="text-red-600">ページ</b>と<b className="text-red-600">コンテンツ</b>が掲載画面に表示されます。動画・資料は<b>URL埋め込み</b>、公開対象は<b>属性＋公開条件</b>で出し分けます。</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {sortedPages.map((p) => (
            <button key={p.id} onClick={() => setCurPageId(p.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold border ${p.id === curPageId ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
              {p.abbr || p.name}<span className="text-xs opacity-70">{contents.filter((c) => c.pageId === p.id).length}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowPages(true)} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50">🗂 ページを管理</button>
        <button onClick={() => setCEdit(newContent())} disabled={!curPage} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">＋ コンテンツを追加</button>
      </div>

      {curPage && (
        <div className="flex items-center gap-2.5 flex-wrap text-[11.5px] text-gray-400">
          <span>ページ：<b className="text-gray-600">{curPage.name}</b>（略称：{curPage.abbr}）</span>
          <span>登録日時：{fmt(curPage.createdAt)}</span>
          <span>公開対象：</span><TargetTags attrIds={curPage.attrIds} mode={curPage.attrMode} index={index} />
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {!curPage ? <div className="text-center text-gray-300 py-10 text-sm">ページがありません。「ページを管理」から作成してください。</div>
          : items.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">このページにコンテンツはありません。</div>
          : items.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => moveContent(i, -1)} disabled={i === 0} title="上へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
                <button onClick={() => moveContent(i, 1)} disabled={i === items.length - 1} title="下へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
              </div>
              <div className="w-16 h-11 rounded-lg shrink-0 bg-center bg-cover flex items-center justify-center text-white text-xs"
                style={c.thumbUrl ? { backgroundImage: `url('${c.thumbUrl}')` } : { background: c.kind === "video" ? "linear-gradient(135deg,#17171b,#3a0a0e)" : c.kind === "doc" ? "linear-gradient(135deg,#2b2b31,#111)" : "linear-gradient(135deg,#e0e7ff,#f1f5f9)" }}>
                {!c.thumbUrl && (c.kind === "video" ? "▶" : c.kind === "doc" ? "📄" : "")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{c.name || "（無題）"}</div>
                <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${c.kind === "video" ? "bg-red-50 text-red-600" : c.kind === "doc" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"}`}>{KIND_LABEL[c.kind]}</span>
                  <TargetTags attrIds={c.attrIds} mode={c.attrMode} index={index} />
                  <span>{c.createdAt ? c.createdAt.slice(0, 10) : ""}</span>
                </div>
              </div>
              <button onClick={() => togglePub(c)} title="公開/非公開" className={`relative w-10 h-[21px] rounded-full shrink-0 ${c.published ? "bg-green-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${c.published ? "left-[21px]" : "left-0.5"}`} />
              </button>
              <button onClick={() => setCEdit({ ...c })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
            </div>
          ))}
      </div>

      {/* コンテンツ編集モーダル */}
      {cEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setCEdit(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{cEdit.id ? "コンテンツを編集" : "コンテンツを追加"}</h2>
              <button onClick={() => setCEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div><label className="text-xs font-bold text-gray-500 block mb-1">登録日時 <span className="text-gray-400 font-normal">自動</span></label>
                <input className={`${input} bg-gray-50 text-gray-500`} value={fmt(cEdit.createdAt)} readOnly /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">コンテンツ名 <span className="text-red-500">*</span></label>
                <input className={input} value={cEdit.name} onChange={(e) => setCEdit({ ...cEdit, name: e.target.value })} /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-gray-400 font-normal">未選択なら全員</span></label>
                <AttrCascadePicker tree={tree} index={index} value={cEdit.attrIds} onChange={(ids) => setCEdit({ ...cEdit, attrIds: ids })} />
                <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                  <select className={`${input} bg-white`} value={cEdit.attrMode} onChange={(e) => setCEdit({ ...cEdit, attrMode: e.target.value as PublishMode })}>
                    {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select></div>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">サムネイル画像URL <span className="text-gray-400 font-normal">任意・未設定なら種別の既定サムネ</span></label>
                <input className={input} value={cEdit.thumbUrl} onChange={(e) => setCEdit({ ...cEdit, thumbUrl: e.target.value })} placeholder="https://…/thumbnail.jpg" /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1.5">コンテンツ種別</label>
                <div className="inline-flex bg-gray-100 rounded-lg p-1">
                  {(["video", "doc", "none"] as const).map((k) => (
                    <button key={k} onClick={() => setCEdit({ ...cEdit, kind: k })}
                      className={`px-3.5 py-1.5 text-sm font-bold rounded-md ${cEdit.kind === k ? "bg-white text-red-600 shadow-sm" : "text-gray-500"}`}>
                      {k === "video" ? "🎬 動画" : k === "doc" ? "📄 資料" : "📝 なし（記事）"}
                    </button>
                  ))}
                </div>
              </div>

              {cEdit.kind === "video" && (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">動画URL <span className="text-gray-400 font-normal">YouTube等の埋め込みURL</span></label>
                  <input type="url" className={input} value={cEdit.url} onChange={(e) => setCEdit({ ...cEdit, url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></div>
              )}
              {cEdit.kind === "doc" && (
                <div><label className="text-xs font-bold text-gray-500 block mb-1">資料URL <span className="text-gray-400 font-normal">Google Drive / PDF 等の埋め込み・共有URL</span></label>
                  <input type="url" className={input} value={cEdit.url} onChange={(e) => setCEdit({ ...cEdit, url: e.target.value })} placeholder="https://…" /></div>
              )}
              {/* 本文（テキスト/HTML）：種別に関わらず入力可。動画・資料では説明文として併記される。 */}
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">
                  本文 <span className="text-gray-400 font-normal">{cEdit.kind === "none" ? "テキスト または HTML" : "任意・動画/資料の説明として表示"}</span>
                </label>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5 mb-2">
                  {(["text", "html"] as const).map((m) => (
                    <button key={m} onClick={() => setCEdit({ ...cEdit, noneMode: m })}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md ${cEdit.noneMode === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>{m === "text" ? "テキスト" : "HTMLコード"}</button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mb-1.5">テキストはURLを自動リンク化、HTMLはそのまま反映されます。</p>
                {cEdit.noneMode === "text"
                  ? <textarea className={`${input} min-h-[120px]`} value={cEdit.bodyText} onChange={(e) => setCEdit({ ...cEdit, bodyText: e.target.value })} placeholder="本文（テキスト）" />
                  : <textarea className={`${input} min-h-[120px] font-mono text-[13px]`} value={cEdit.bodyHtml} onChange={(e) => setCEdit({ ...cEdit, bodyHtml: e.target.value })} placeholder="<h3>見出し</h3>…" />}
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1.5">プレビュー <span className="text-gray-400 font-normal">掲載時の見え方</span></label>
                <div className="border border-dashed border-gray-300 rounded-xl p-3 bg-gray-50">
                  <div className="text-[10px] text-gray-400 mb-2">{cEdit.name || "（コンテンツ名）"}</div>
                  {cEdit.kind === "video" && (cEdit.url
                    ? <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}><iframe src={toEmbedUrl(cEdit.url)} title="preview" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} /></div>
                    : <div className="text-xs text-gray-400 py-6 text-center">動画URL未入力</div>)}
                  {cEdit.kind === "doc" && (cEdit.url
                    ? <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: 240 }}><iframe src={cEdit.url} title="preview" style={{ width: "100%", height: "100%", border: 0 }} /></div>
                    : <div className="text-xs text-gray-400 py-6 text-center">資料URL未入力</div>)}
                  {(cEdit.noneMode === "html" ? cEdit.bodyHtml.trim() : cEdit.bodyText.trim()) ? (
                    <div className={`text-[13.5px] leading-7 text-gray-700 bg-white border border-gray-200 rounded-lg p-3 content-rich ${cEdit.kind !== "none" ? "mt-2" : ""}`}
                      dangerouslySetInnerHTML={{ __html: cEdit.noneMode === "html" ? cEdit.bodyHtml : linkify(cEdit.bodyText) }} />
                  ) : (cEdit.kind === "none" ? <div className="text-xs text-gray-400 py-6 text-center">本文未入力</div> : null)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {cEdit.id ? <button onClick={doDeleteContent} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setCEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <button onClick={doSaveContent} className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ページ管理モーダル */}
      {showPages && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPages(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">🗂 ページを管理</h2>
              <button onClick={() => setShowPages(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 overflow-y-auto space-y-2">
              {sortedPages.length === 0 && <div className="text-center text-gray-300 py-6 text-sm">ページがありません</div>}
              {sortedPages.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2.5">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => movePage(i, -1)} disabled={i === 0} title="上へ"
                      className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
                    <button onClick={() => movePage(i, 1)} disabled={i === sortedPages.length - 1} title="下へ"
                      className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-800">{p.name} <span className="text-[11px] text-gray-400">（{p.abbr}）</span></div>
                    <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5"><span>登録：{p.createdAt ? p.createdAt.slice(0, 10) : "—"}</span><TargetTags attrIds={p.attrIds} mode={p.attrMode} index={index} /></div>
                  </div>
                  <button onClick={() => setPageEdit({ ...p })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">編集</button>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setPageEdit(newPage())} className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">＋ ページを追加</button>
            </div>
          </div>
        </div>
      )}

      {/* ページ編集モーダル */}
      {pageEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setPageEdit(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{pageEdit.id ? "ページを編集" : "ページを追加"}</h2>
              <button onClick={() => setPageEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div><label className="text-xs font-bold text-gray-500 block mb-1">登録日時 <span className="text-gray-400 font-normal">自動</span></label>
                <input className={`${input} bg-gray-50 text-gray-500`} value={fmt(pageEdit.createdAt)} readOnly /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">ページ名 <span className="text-red-500">*</span></label>
                <input className={input} value={pageEdit.name} onChange={(e) => setPageEdit({ ...pageEdit, name: e.target.value })} /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">ページ名略称 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">タブに表示</span></label>
                <input className={input} value={pageEdit.abbr} onChange={(e) => setPageEdit({ ...pageEdit, abbr: e.target.value })} /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-gray-400 font-normal">未選択なら全員</span></label>
                <AttrCascadePicker tree={tree} index={index} value={pageEdit.attrIds} onChange={(ids) => setPageEdit({ ...pageEdit, attrIds: ids })} />
                <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                  <select className={`${input} bg-white`} value={pageEdit.attrMode} onChange={(e) => setPageEdit({ ...pageEdit, attrMode: e.target.value as PublishMode })}>
                    {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select></div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {pageEdit.id ? <button onClick={doDeletePage} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setPageEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <button onClick={doSavePage} className="text-sm py-2 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
