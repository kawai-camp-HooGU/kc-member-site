"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchContentData, savePage, deletePage, saveContent, deleteContent, setPublished, toEmbedUrl,
  saveContentOrder, savePageOrder, contentPublicUrl,
} from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex, attrSegs, attrLabel } from "../../lib/members";
import { AttrCascadePicker } from "../master/AttrCascadePicker";
import { ContentEngagementView } from "./ContentEngagementView";
import { AiHtmlBar } from "./AiHtmlBar";
import { Icon } from "../common/Icon";
import { useMaster } from "../../hooks/useMaster";
import { renderBodyHtml } from "../../lib/richText";
import { SaveButton } from "../common/SaveButton";
import { isValidUrl } from "../../lib/validators";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
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
  const { can } = useMaster();
  const confirm = useConfirm();
  const toast = useToast();
  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [curPageId, setCurPageId] = useState<number | null>(null);
  const [pageEdit, setPageEdit] = useState<ContentPage | null>(null);
  const [showPages, setShowPages] = useState(false);
  const [cEdit, setCEdit] = useState<CmsContent | null>(null);
  const [mode, setMode] = useState<"edit" | "engagement">("edit");   // 編集 ／ 視聴状況
  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  // ── ④ AI HTML生成 用の状態 ──
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [htmlUndo, setHtmlUndo] = useState<string | null>(null);
  const syncSel = () => {
    const ta = htmlRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    setSel(e > s ? { start: s, end: e } : null);
  };
  const applyAiHtml = (next: string) => {
    if (!cEdit) return;
    setHtmlUndo(cEdit.bodyHtml);
    setCEdit({ ...cEdit, bodyHtml: next });
    setSel(null);
  };
  const undoAiHtml = () => {
    if (!cEdit || htmlUndo == null) return;
    setCEdit({ ...cEdit, bodyHtml: htmlUndo });
    setHtmlUndo(null);
  };

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
    id: 0, pageId: curPageId ?? 0, name: "", createdAt: "", publicToken: "", isExternal: false,
    sortOrder: items.length, published: true,
    kind: "none", url: "", noneMode: "text", bodyText: "", bodyHtml: "", thumbUrl: "", attrMode: "any", attrIds: [],
  });

  /** 公開URLをクリップボードへ */
  const copyPublicUrl = async (token: string) => {
    const url = contentPublicUrl(token);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("公開URLをコピーしました");
    } catch {
      toast.error("コピーできませんでした（URLを選択して手動でコピーしてください）");
    }
  };
  const newPage = (): ContentPage => ({ id: 0, name: "", abbr: "", createdAt: "", sortOrder: pages.length, attrMode: "any", attrIds: [] });

  const doSaveContent = async () => {
    if (!cEdit) return;
    if (!cEdit.name.trim()) { alert("コンテンツ名を入力してください"); return; }
    // 動画/資料URLの形式チェック（不正URLだと掲載画面の埋め込みが404になるため）
    if (cEdit.kind === "video" && !isValidUrl(cEdit.url)) {
      alert("動画URLが正しくありません（https:// で始まる有効なURLを入力してください）"); return;
    }
    if (cEdit.kind === "doc" && cEdit.url.trim() && !isValidUrl(cEdit.url)) {
      alert("資料URLが正しくありません（https:// で始まる有効なURLを入力してください）"); return;
    }
    // htmlUndo が入っている＝この編集でAI生成を使った（監査フラグ）
    const savedId = await saveContent(cEdit, htmlUndo != null);
    if (savedId == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    setCEdit(null); setHtmlUndo(null); setSel(null); await reload();
    toast.success("保存しました");
  };
  const doDeleteContent = async () => {
    if (!cEdit?.id) return;
    if (!(await confirm({ title: "コンテンツを削除", message: `「${cEdit.name}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return;
    await deleteContent(cEdit.id); setCEdit(null); await reload();
    toast.success("削除しました");
  };
  const doSavePage = async () => {
    if (!pageEdit) return;
    if (!pageEdit.name.trim() || !pageEdit.abbr.trim()) { alert("ページ名と略称を入力してください"); return; }
    const id = await savePage(pageEdit);
    if (id == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    setPageEdit(null); await reload();
    setCurPageId(id);
    toast.success("保存しました");
  };
  const doDeletePage = async () => {
    if (!pageEdit?.id) return;
    if (contents.some((c) => c.pageId === pageEdit.id)) { alert("コンテンツが残っているため削除できません"); return; }
    if (!(await confirm({ title: "ページを削除", message: `ページ「${pageEdit.name}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return;
    await deletePage(pageEdit.id); setPageEdit(null); await reload();
    toast.success("削除しました");
  };
  const togglePub = async (c: CmsContent) => {
    await setPublished(c.id, !c.published);
    setContents((prev) => prev.map((x) => x.id === c.id ? { ...x, published: !x.published } : x));
  };

  const segBtn = (on: boolean) =>
    `px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${on ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          <button type="button" className={segBtn(mode === "edit")} onClick={() => setMode("edit")}>
            <span className="inline-flex items-center gap-1.5"><Icon name="settings" size={15} />コンテンツ編集</span>
          </button>
          <button type="button" className={segBtn(mode === "engagement")} onClick={() => setMode("engagement")}>
            <span className="inline-flex items-center gap-1.5"><Icon name="chart" size={15} />視聴状況</span>
          </button>
        </div>
      </div>

      {mode === "engagement" ? <ContentEngagementView /> : (
      <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="settings" size={18} /></span>
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
        <button onClick={() => setShowPages(true)} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50"><span className="inline-flex items-center gap-1.5"><Icon name="grid" size={16} />ページを管理</span></button>
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
                {!c.thumbUrl && (c.kind === "video" ? <Icon name="content" size={20} /> : c.kind === "doc" ? <Icon name="doc" size={18} /> : <Icon name="article" size={18} className="text-indigo-400" />)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{c.name || "（無題）"}</div>
                <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${c.kind === "video" ? "bg-red-50 text-red-600" : c.kind === "doc" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"}`}>{KIND_LABEL[c.kind]}</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${c.isExternal ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {c.isExternal ? "外部公開" : "会員のみ"}
                  </span>
                  <TargetTags attrIds={c.attrIds} mode={c.attrMode} index={index} />
                  <span>{c.createdAt ? c.createdAt.slice(0, 10) : ""}</span>
                </div>
              </div>
              <button onClick={() => copyPublicUrl(c.publicToken)} disabled={!c.publicToken} title={contentPublicUrl(c.publicToken) || "公開URL未発行"}
                className="shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-30">URLコピー</button>
              <button onClick={() => togglePub(c)} title="公開/非公開" className={`relative w-10 h-[21px] rounded-full shrink-0 ${c.published ? "bg-green-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${c.published ? "left-[21px]" : "left-0.5"}`} />
              </button>
              <button onClick={() => setCEdit({ ...c })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
            </div>
          ))}
      </div>
      </div>
      )}

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

              {/* 公開URL：新規登録時にDBが自動発行し、以後変更不可（編集不可の readOnly） */}
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">公開URL <span className="text-gray-400 font-normal">自動発行・編集不可</span></label>
                {cEdit.publicToken ? (
                  <div className="flex gap-2">
                    <input className={`${input} bg-gray-100 text-gray-600 font-mono text-[12.5px]`}
                      value={contentPublicUrl(cEdit.publicToken)} readOnly
                      onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" onClick={() => copyPublicUrl(cEdit.publicToken)}
                      className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">コピー</button>
                    <a href={contentPublicUrl(cEdit.publicToken)} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">開く ↗</a>
                  </div>
                ) : (
                  <input className={`${input} bg-gray-50 text-gray-400 italic border-dashed`}
                    value="保存すると自動で発行されます" readOnly />
                )}
                <p className="text-[11px] text-gray-400 mt-1.5">新規登録（保存）時に一意のURLを自動発行します。以降は変更・削除できません。</p>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">コンテンツ名 <span className="text-red-500">*</span></label>
                <input className={input} value={cEdit.name} onChange={(e) => setCEdit({ ...cEdit, name: e.target.value })} /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-gray-400 font-normal">未選択なら全員</span></label>
                <AttrCascadePicker tree={tree} index={index} value={cEdit.attrIds} onChange={(ids) => setCEdit({ ...cEdit, attrIds: ids })} />
                <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                  <select className={`${input} bg-white`} value={cEdit.attrMode} onChange={(e) => setCEdit({ ...cEdit, attrMode: e.target.value as PublishMode })}>
                    {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select></div>

                {/* 外部公開：ONなら公開URLを知る全員が未ログインで閲覧可（属性条件は無視） */}
                <label className={`mt-2.5 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${cEdit.isExternal ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600"
                    checked={cEdit.isExternal} onChange={(e) => setCEdit({ ...cEdit, isExternal: e.target.checked })} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${cEdit.isExternal ? "text-emerald-800" : "text-gray-700"}`}>外部公開</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${cEdit.isExternal ? "text-emerald-700" : "text-gray-500"}`}>
                      ONにすると、上の公開対象属性に関わらず<b>公開URLを知っている人は誰でもログイン不要で閲覧</b>できます。
                      OFFのときは会員のみ・属性条件どおりの出し分けになります。
                    </span>
                  </span>
                </label>
                {cEdit.isExternal && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    ※ 公開対象属性・公開条件は、会員ポータル側の一覧表示にのみ適用されます。<br />
                    ※ 公開トグル（一覧の緑スイッチ）がOFFの場合は、外部公開ONでも公開URLは表示されません。
                  </p>
                )}
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">サムネイル画像URL <span className="text-gray-400 font-normal">任意・未設定なら種別の既定サムネ</span></label>
                <input className={input} value={cEdit.thumbUrl} onChange={(e) => setCEdit({ ...cEdit, thumbUrl: e.target.value })} placeholder="https://…/thumbnail.jpg" /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1.5">コンテンツ種別</label>
                <div className="inline-flex bg-gray-100 rounded-lg p-1">
                  {(["video", "doc", "none"] as const).map((k) => (
                    <button key={k} onClick={() => setCEdit({ ...cEdit, kind: k })}
                      className={`px-3.5 py-1.5 text-sm font-bold rounded-md ${cEdit.kind === k ? "bg-white text-red-600 shadow-sm" : "text-gray-500"}`}>
                      <span className="inline-flex items-center gap-1.5"><Icon name={k === "video" ? "video" : k === "doc" ? "doc" : "article"} size={16} />{k === "video" ? "動画" : k === "doc" ? "資料" : "なし（記事）"}</span>
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

                {/* ④ AIでHTMLを生成 / 修正（HTMLモードのときだけ） */}
                {cEdit.noneMode === "html" && can("ai_html") && (
                  <AiHtmlBar html={cEdit.bodyHtml} selection={sel} onApply={applyAiHtml} />
                )}

                {cEdit.noneMode === "text"
                  ? <textarea className={`${input} min-h-[120px]`} value={cEdit.bodyText} onChange={(e) => setCEdit({ ...cEdit, bodyText: e.target.value })} placeholder="本文（テキスト）" />
                  : (
                    <>
                      <textarea ref={htmlRef} className={`${input} min-h-[120px] font-mono text-[13px]`}
                        value={cEdit.bodyHtml}
                        onChange={(e) => setCEdit({ ...cEdit, bodyHtml: e.target.value })}
                        onSelect={syncSel} onKeyUp={syncSel} onMouseUp={syncSel} onBlur={syncSel}
                        placeholder="<h3>見出し</h3>…" />
                      {htmlUndo != null && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10.5px] text-red-600 font-bold">✦ AIの生成結果を反映しました</span>
                          <span className="text-[10.5px] text-gray-400">— プレビューを確認してから保存してください</span>
                          <button onClick={undoAiHtml}
                            className="ml-auto text-[10.5px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                            ↶ 元に戻す
                          </button>
                        </div>
                      )}
                    </>
                  )}
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
                      dangerouslySetInnerHTML={{ __html: renderBodyHtml(cEdit.noneMode, cEdit.bodyText, cEdit.bodyHtml) }} />
                  ) : (cEdit.kind === "none" ? <div className="text-xs text-gray-400 py-6 text-center">本文未入力</div> : null)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {cEdit.id ? <button onClick={doDeleteContent} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setCEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSaveContent} />
            </div>
          </div>
        </div>
      )}

      {/* ページ管理モーダル */}
      {showPages && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPages(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800"><span className="inline-flex items-center gap-1.5"><Icon name="grid" size={16} />ページを管理</span></h2>
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
              <SaveButton onSave={doSavePage} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
