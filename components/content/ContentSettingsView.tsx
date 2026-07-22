"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchContentData, savePage, deletePage, saveContent, deleteContent, setPublished, setPagePublished, toEmbedUrl,
  saveContentOrder, savePageOrder, contentPublicUrl, pagePublicUrl, toImageUrl, THUMB_ASPECT, THUMB_HINT,
  uploadContentFile, removeContentFile, formatBytes, CONTENT_FILE_MAX, CONTENT_VIDEO_MAX,
} from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { ThumbFrame } from "./ThumbFrame";
import { AttrTable } from "../master/AttrTable";
import { AttrChips } from "../master/AttrChips";
import { UrlField } from "../common/UrlField";
import { ContentEngagementView } from "./ContentEngagementView";
import { AiHtmlBar } from "./AiHtmlBar";
import { Icon } from "../common/Icon";
import { useMaster } from "../../hooks/useMaster";
import { useRoute } from "../../hooks/useRoute";
import { renderBodyHtml } from "../../lib/richText";
import { SaveButton } from "../common/SaveButton";
import { isValidUrl } from "../../lib/validators";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import type { ContentPage, CmsContent, PublishMode } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { FIELD_INPUT } from "../../lib/constants";
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
const input = FIELD_INPUT;

// 属性の表示は AttrChips（顧客詳細画面と同じ仕様）に統一。ここでは「全員」表記だけ足す。
function TargetTags({ attrIds, mode, index }: { attrIds: number[]; mode: PublishMode; index: AttrIndex }) {
  return <AttrChips index={index} ids={attrIds} mode={attrIds.length ? mode : undefined} emptyLabel="全員" />;
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
  const [cEdit, setCEdit] = useState<CmsContent | null>(null);
  const [uploading, setUploading] = useState(false);   // 資料ファイルのアップロード中
  // 「全員に公開する」チェック状態（コンテンツ／ページ別）。
  //   公開対象は「全員」か「属性1つ以上」のどちらか必須にする。
  //   ⚠️ DB列は持たず、属性が空＝全員という既存仕様のまま。この state は入力時の必須判定と
  //      チェックの復元だけに使う（既存データ＝属性が空なら編集時はONで復元、新規はOFF）。
  const [cPublishAll, setCPublishAll] = useState(false);
  const [pagePublishAll, setPagePublishAll] = useState(false);
  // 右パネルは一度に1つだけ開く（コンテンツ編集／ページ管理／ページ編集は排他）。
  const openContentEdit = (c: CmsContent) => {
    setHtmlUndo(null); setSel(null);
    setCEdit({ ...c }); setCPublishAll(!!c.id && c.attrIds.length === 0);
  };
  const openPageEdit = (p: ContentPage) => {
    setCEdit(null); setPageEdit({ ...p }); setPagePublishAll(!!p.id && p.attrIds.length === 0);
  };
  // 複写：既存を土台に「新規（id=0）」として編集を開く。公開URLは新規発行されるので空に。
  //   保存するまではDBに増えない（ユーザーが内容を確認してから保存できる）。
  const duplicateContent = (c: CmsContent) => {
    setHtmlUndo(null); setSel(null);
    setCEdit({ ...c, id: 0, publicToken: "", name: `${c.name}（複写）`, createdAt: "", sortOrder: items.length });
    setCPublishAll(c.attrIds.length === 0);
  };
  const duplicatePage = (p: ContentPage) => {
    setCEdit(null);
    setPageEdit({ ...p, id: 0, publicToken: "", name: `${p.name}（複写）`, createdAt: "", sortOrder: pages.length });
    setPagePublishAll(p.attrIds.length === 0);
  };
  // 編集 ／ 視聴状況（/ops/master/content?mode=engagement）
  const route = useRoute();
  const mode: "edit" | "page" | "engagement" =
    route.q("mode") === "engagement" ? "engagement" : route.q("mode") === "page" ? "page" : "edit";
  const setMode = (m: "edit" | "page" | "engagement") => route.setQuery({ mode: m === "edit" ? null : m });
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
    filePath: "", fileName: "", fileSize: 0,
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
  const newPage = (): ContentPage => ({ id: 0, name: "", abbr: "", overview: "", createdAt: "", sortOrder: pages.length, attrMode: "any", attrIds: [], publicToken: "", isExternal: false, published: true });

  /** ページ公開URLをクリップボードへ */
  const copyPageUrl = async (token: string) => {
    const url = pagePublicUrl(token);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("公開URLをコピーしました");
    } catch {
      toast.error("コピーできませんでした（URLを選択して手動でコピーしてください）");
    }
  };
  /** ページの公開トグル（一覧・編集共通） */
  const togglePagePub = async (p: ContentPage) => {
    await setPagePublished(p.id, !p.published);
    setPages((prev) => prev.map((x) => x.id === p.id ? { ...x, published: !x.published } : x));
    setPageEdit((cur) => cur && cur.id === p.id ? { ...cur, published: !p.published } : cur);
  };

  // ── 資料ファイル（PDF）のアップロード ──
  //   実体はプライベートバケットへ。ダウンロードURLは閲覧権限を見てからサーバーが発行する。
  //   ⚠️ uploading の useState はコンポーネント冒頭（早期returnより前）で宣言すること。
  //      ここに書くと「読み込み中」の描画ではフックが呼ばれず、フック数が変わって
  //      React error #310（Rendered more hooks than during the previous render）になる。
  // 資料・動画で共通。上限は用途で変える（動画は大きめ CONTENT_VIDEO_MAX）。
  const pickFile = async (f: File, maxBytes: number = CONTENT_FILE_MAX) => {
    if (!cEdit) return;
    setUploading(true);
    const { path, error } = await uploadContentFile(f, maxBytes);
    setUploading(false);
    if (!path) { toast.error(error ?? "アップロードに失敗しました"); return; }
    // 差し替え時は古い実体を消す（ストレージにゴミを残さない）
    if (cEdit.filePath) await removeContentFile(cEdit.filePath);
    setCEdit({ ...cEdit, filePath: path, fileName: f.name, fileSize: f.size });
    toast.success("アップロードしました（保存すると反映されます）");
  };

  const removeFile = async () => {
    if (!cEdit?.filePath) return;
    await removeContentFile(cEdit.filePath);
    setCEdit({ ...cEdit, filePath: "", fileName: "", fileSize: 0 });
    toast.success("ファイルを削除しました");
  };

  const doSaveContent = async () => {
    if (!cEdit) return;
    if (!cEdit.name.trim()) { alert("コンテンツ名を入力してください"); return; }
    // 公開対象は「全員に公開」か「属性1つ以上」のどちらか必須
    if (!cPublishAll && cEdit.attrIds.length === 0) {
      alert("公開対象を指定してください（属性を1つ以上指定するか、「全員に公開する」にチェック）"); return;
    }
    // 動画/資料URLの形式チェック（不正URLだと掲載画面の埋め込みが404になるため）
    //   ⚠️ 動画ファイルをアップロード済み（filePath あり）のときはURL不要。
    //      アップロードが優先され、URL欄は無効化される（＝空でも正常）。
    if (cEdit.kind === "video" && !cEdit.filePath && !isValidUrl(cEdit.url)) {
      alert("動画URLを入力するか、動画ファイルをアップロードしてください（URLは https:// で始まる有効なURL）"); return;
    }
    if (cEdit.kind === "doc" && cEdit.url.trim() && !isValidUrl(cEdit.url)) {
      alert("資料URLが正しくありません（https:// で始まる有効なURLを入力してください）"); return;
    }
    // htmlUndo が入っている＝この編集でAI生成を使った（監査フラグ）
    const res = await saveContent(cEdit, htmlUndo != null);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
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
    if (!pagePublishAll && pageEdit.attrIds.length === 0) {
      alert("公開対象を指定してください（属性を1つ以上指定するか、「全員に公開する」にチェック）"); return;
    }
    const res = await savePage(pageEdit);
    if (res.id == null) { toast.error(`保存に失敗しました：${res.error}`); return; }
    setPageEdit(null); await reload();
    setCurPageId(res.id);
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
    setCEdit((cur) => cur && cur.id === c.id ? { ...cur, published: !c.published } : cur);
  };
  // 右パネル（編集）が開いているか。開くと一覧＋編集の2カラム、閉じると一覧が全幅。
  const contentDetailOpen = !!cEdit;   // コンテンツ編集タブ
  const pageDetailOpen = !!pageEdit;   // ページ管理タブ

  const segBtn = (on: boolean) =>
    `px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${on ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          <button type="button" className={segBtn(mode === "page")} onClick={() => setMode("page")}>
            <span className="inline-flex items-center gap-1.5"><Icon name="grid" size={15} />ページ管理</span>
          </button>
          <button type="button" className={segBtn(mode === "edit")} onClick={() => setMode("edit")}>
            <span className="inline-flex items-center gap-1.5"><Icon name="settings" size={15} />コンテンツ編集</span>
          </button>
          <button type="button" className={segBtn(mode === "engagement")} onClick={() => setMode("engagement")}>
            <span className="inline-flex items-center gap-1.5"><Icon name="chart" size={15} />視聴状況</span>
          </button>
        </div>
      </div>

      {mode === "engagement" ? <ContentEngagementView /> : mode === "edit" ? (
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
        <button onClick={() => openContentEdit(newContent())} disabled={!curPage} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">＋ コンテンツを追加</button>
      </div>

      {curPage && (
        <div className="flex items-center gap-2.5 flex-wrap text-[11.5px] text-gray-400">
          <span>ページ：<b className="text-gray-600">{curPage.name}</b>（略称：{curPage.abbr}）</span>
          <span>登録日時：{fmt(curPage.createdAt)}</span>
          <span>公開対象：</span><TargetTags attrIds={curPage.attrIds} mode={curPage.attrMode} index={index} />
        </div>
      )}

      {/* 一覧（左）＋ 編集パネル（右）の左右分割。開くと2カラム、閉じると一覧が全幅。 */}
      <div className={contentDetailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start" : ""}>

      {/* ── 左：コンテンツ一覧 ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
        {!curPage ? <div className="text-center text-gray-300 py-10 text-sm">ページがありません。「ページを管理」から作成してください。</div>
          : items.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">このページにコンテンツはありません。</div>
          : items.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${cEdit && cEdit.id === c.id && c.id !== 0 ? "bg-red-50" : ""}`}>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => moveContent(i, -1)} disabled={i === 0} title="上へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
                <button onClick={() => moveContent(i, 1)} disabled={i === items.length - 1} title="下へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
              </div>
              <div className="w-16 h-11 rounded-lg shrink-0 overflow-hidden bg-center bg-cover flex items-center justify-center text-white text-xs"
                style={{ background: c.kind === "video" ? "linear-gradient(135deg,#17171b,#3a0a0e)" : c.kind === "doc" ? "linear-gradient(135deg,#2b2b31,#111)" : "linear-gradient(135deg,#c7d2fe,#e0e7ff)" }}>
                {c.thumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={toImageUrl(c.thumbUrl)} alt="" className="w-full h-full object-contain"
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  : (c.kind === "video" ? <Icon name="content" size={20} /> : c.kind === "doc" ? <Icon name="doc" size={18} /> : <Icon name="article" size={18} className="text-indigo-600" />)}
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
              <button onClick={() => duplicateContent(c)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 shrink-0">複写</button>
              <button onClick={() => openContentEdit(c)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
            </div>
          ))}
      </div>

      {/* ── 右：コンテンツ編集パネル（画面外クリックでは閉じない）── */}
      {cEdit && (
      <div className="lg:sticky lg:top-4 self-start min-w-0">

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{cEdit.id ? "コンテンツを編集" : "コンテンツを追加"}</h2>
              <div className="flex items-center gap-3">
                {cEdit.id ? (
                  <button onClick={() => togglePub(cEdit)} title="公開/非公開" className="inline-flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold ${cEdit.published ? "text-green-600" : "text-gray-400"}`}>{cEdit.published ? "公開中" : "非公開"}</span>
                    <span className={`relative w-10 h-[21px] rounded-full ${cEdit.published ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${cEdit.published ? "left-[21px]" : "left-0.5"}`} />
                    </span>
                  </button>
                ) : null}
                <button onClick={() => setCEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
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

              {/* 会員ポータル内のURL（ログイン必須。公開URLとは別物） */}
              <UrlField label="会員ポータルURL" hint="ログインが必要・公開対象の会員のみ閲覧可"
                path={cEdit.id ? `/content/${cEdit.id}` : ""} />

              <div><label className="text-xs font-bold text-gray-500 block mb-1">コンテンツ名 <span className="text-red-500">*</span></label>
                <input className={input} value={cEdit.name} onChange={(e) => setCEdit({ ...cEdit, name: e.target.value })} /></div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">必須</span></label>

                {/* 全員に公開する：ONなら属性指定なしで対象ロール全員に公開（初期OFF） */}
                <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${cPublishAll ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600"
                    checked={cPublishAll}
                    onChange={(e) => { const on = e.target.checked; setCPublishAll(on); if (on) setCEdit({ ...cEdit, attrIds: [] }); }} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${cPublishAll ? "text-emerald-800" : "text-gray-700"}`}>全員に公開する</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${cPublishAll ? "text-emerald-700" : "text-gray-500"}`}>
                      属性の指定なしで、対象ロール全員に公開します。
                    </span>
                  </span>
                </label>

                {!cPublishAll && (
                  <div className="mt-2.5">
                    <AttrTable tree={tree} index={index} value={cEdit.attrIds}
                      onChange={(ids) => setCEdit({ ...cEdit, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
                    <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                      <select className={`${input} bg-white`} value={cEdit.attrMode} onChange={(e) => setCEdit({ ...cEdit, attrMode: e.target.value as PublishMode })}>
                        {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select></div>
                    {cEdit.attrIds.length === 0 && (
                      <p className="text-[11px] text-red-600 mt-1.5">
                        ⚠ 属性を1つ以上指定するか、「全員に公開する」にチェックしてください
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-2.5" />

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

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">サムネイル画像URL <span className="text-gray-400 font-normal">任意・未設定なら種別の既定サムネ</span></label>
                <input className={input} value={cEdit.thumbUrl}
                  onChange={(e) => setCEdit({ ...cEdit, thumbUrl: e.target.value })}
                  placeholder="Googleドライブの共有URLを貼り付け（自動変換されます）" />
                <p className="text-[11px] mt-1.5">
                  <b className="text-indigo-600">{THUMB_HINT}</b>
                  <span className="text-gray-400">　一覧・詳細・公開ページのすべてで 16:9 の枠に全体が収まるように表示します（切り抜きません）。比率が違う画像は左右または上下にぼかし余白が入ります。</span>
                </p>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  Googleドライブの共有URL（<span className="font-mono">…/file/d/xxxx/view</span>）をそのまま貼れます。表示用URLに自動変換します。<br />
                  <b className="text-red-500">共有設定を「リンクを知っている全員」にしてください。</b>「制限付き」のままだと会員には表示されません。
                </p>
                {cEdit.thumbUrl && (
                  <div className="mt-2 flex items-center gap-2.5">
                    {/* 実画面と同じ表示ルールのプレビュー（ThumbFrame） */}
                    <ThumbFrame src={toImageUrl(cEdit.thumbUrl)}
                      className="w-28 rounded-lg border border-gray-200 shrink-0"
                      style={{ aspectRatio: THUMB_ASPECT }} />
                    <div className="text-[10.5px] text-gray-400 break-all min-w-0">
                      表示用URL：<span className="font-mono">{toImageUrl(cEdit.thumbUrl)}</span>
                    </div>
                  </div>
                )}
              </div>

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
                <div className="space-y-3">
                  {/* ── ① 動画ファイルをアップロード（会員限定にできる）── */}
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">
                      動画をアップロード <span className="text-gray-400 font-normal">mp4など・会員限定にできます（上限 {formatBytes(CONTENT_VIDEO_MAX)}）</span>
                    </label>

                    {cEdit.filePath ? (
                      <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2.5 bg-gray-50">
                        <span className="text-red-600 shrink-0"><Icon name="video" size={18} /></span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-gray-800 truncate">{cEdit.fileName || "（動画ファイル）"}</div>
                          <div className="text-[11px] text-gray-400">{formatBytes(cEdit.fileSize)}</div>
                        </div>
                        <button onClick={removeFile} disabled={uploading}
                          className="shrink-0 text-[11px] text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-40">
                          削除
                        </button>
                      </div>
                    ) : (
                      <label className={`flex items-center justify-center gap-2 border border-dashed rounded-lg py-4 text-sm font-semibold cursor-pointer ${
                        uploading ? "border-gray-200 text-gray-300" : "border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"}`}>
                        <input type="file" accept="video/mp4,video/*" className="hidden" disabled={uploading}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f, CONTENT_VIDEO_MAX); e.target.value = ""; }} />
                        {uploading ? "アップロード中…" : "＋ 動画ファイルを選択"}
                      </label>
                    )}

                    <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                      非公開のストレージに保存し、閲覧権限を確認してから<b className="text-gray-600">5分間だけ有効なURL</b>で再生します。
                      URLが漏れても第三者は再生できません。
                    </p>
                  </div>

                  {/* ── ② 埋め込みURL（YouTube 等・従来方式）── */}
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">
                      または動画URL <span className="text-gray-400 font-normal">YouTube等の埋め込みURL</span>
                    </label>
                    <input type="url" className={input} value={cEdit.url} disabled={!!cEdit.filePath}
                      onChange={(e) => setCEdit({ ...cEdit, url: e.target.value })}
                      placeholder="https://www.youtube.com/watch?v=…" />
                    <p className="text-[11px] text-gray-400 mt-1">
                      {cEdit.filePath
                        ? "アップロード済みの動画が優先されるため、URLは使われません。"
                        : "YouTube・Google ドライブ等の共有URLを貼れます。会員限定にしたい動画はアップロードを使ってください。"}
                    </p>
                  </div>
                </div>
              )}
              {cEdit.kind === "doc" && (
                <div className="space-y-3">
                  {/* ── ① ファイルをアップロード（推奨）── */}
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">
                      PDFをアップロード <span className="text-gray-400 font-normal">推奨・会員限定にできます（上限 {formatBytes(CONTENT_FILE_MAX)}）</span>
                    </label>

                    {cEdit.filePath ? (
                      <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2.5 bg-gray-50">
                        <span className="text-indigo-600 shrink-0"><Icon name="doc" size={18} /></span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-gray-800 truncate">{cEdit.fileName || "（ファイル）"}</div>
                          <div className="text-[11px] text-gray-400">{formatBytes(cEdit.fileSize)}</div>
                        </div>
                        <button onClick={removeFile} disabled={uploading}
                          className="shrink-0 text-[11px] text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-40">
                          削除
                        </button>
                      </div>
                    ) : (
                      <label className={`flex items-center justify-center gap-2 border border-dashed rounded-lg py-4 text-sm font-semibold cursor-pointer ${
                        uploading ? "border-gray-200 text-gray-300" : "border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"}`}>
                        <input type="file" accept="application/pdf" className="hidden" disabled={uploading}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
                        {uploading ? "アップロード中…" : "＋ PDFファイルを選択"}
                      </label>
                    )}

                    <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                      非公開のストレージに保存し、閲覧権限を確認してから<b className="text-gray-600">5分間だけ有効なURL</b>を発行します。
                      URLが漏れても第三者はダウンロードできません。<b className="text-gray-600">誰がいつ落としたかは記録されます。</b>
                    </p>
                  </div>

                  {/* ── ② 外部URL（従来方式）── */}
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1">
                      または資料URL <span className="text-gray-400 font-normal">Google Drive 等の共有URL</span>
                    </label>
                    <input type="url" className={input} value={cEdit.url} disabled={!!cEdit.filePath}
                      onChange={(e) => setCEdit({ ...cEdit, url: e.target.value })} placeholder="https://…" />
                    <p className="text-[11px] text-gray-400 mt-1">
                      {cEdit.filePath
                        ? "アップロード済みのファイルが優先されるため、URLは使われません。"
                        : "⚠️ 共有設定を「リンクを知っている全員」にする必要があり、URLが漏れると誰でも閲覧できます。会員限定の資料はアップロードを使ってください。"}
                    </p>
                  </div>
                </div>
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
                  {cEdit.kind === "video" && (cEdit.filePath
                    ? <div className="flex items-center gap-2 border border-gray-200 rounded-lg bg-white px-3 py-2.5">
                        <span className="text-red-600"><Icon name="video" size={18} /></span>
                        <div className="min-w-0"><div className="text-[12px] font-bold text-gray-800 truncate">{cEdit.fileName || "（動画ファイル）"}</div>
                          <div className="text-[10.5px] text-gray-400">アップロード動画・{formatBytes(cEdit.fileSize)}</div></div>
                      </div>
                    : cEdit.url
                      ? <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}><iframe src={toEmbedUrl(cEdit.url)} title="preview" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} /></div>
                      : <div className="text-xs text-gray-400 py-6 text-center">動画URL未入力／未アップロード</div>)}
                  {cEdit.kind === "doc" && (cEdit.filePath
                    ? <div className="flex items-center gap-2 border border-gray-200 rounded-lg bg-white px-3 py-2.5">
                        <span className="text-indigo-600"><Icon name="doc" size={18} /></span>
                        <span className="text-[12.5px] font-bold text-gray-700 truncate flex-1">{cEdit.fileName}</span>
                        <span className="text-[11px] text-white bg-red-600 rounded px-2 py-1 font-bold shrink-0">ダウンロード</span>
                      </div>
                    : cEdit.url
                      ? <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: 240 }}><iframe src={toEmbedUrl(cEdit.url)} title="preview" style={{ width: "100%", height: "100%", border: 0 }} /></div>
                      : <div className="text-xs text-gray-400 py-6 text-center">PDF未アップロード／資料URL未入力</div>)}
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

      </div>
      </div>
      ) : (

      <div className="space-y-4">
      {/* ===================== ページ管理タブ ===================== */}
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="grid" size={18} /></span>
        <p className="leading-relaxed m-0">掲載画面の<b className="text-red-600">タブ（ページ）</b>をここで作成・並び替え・公開設定します。各ページは<b>公開URL（/p/…）</b>で1枚まるごと共有できます。</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[11.5px] text-gray-400">ページ数：<b className="text-gray-600">{sortedPages.length}</b></div>
        <div className="flex-1" />
        <button onClick={() => openPageEdit(newPage())} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ ページを追加</button>
      </div>

      {/* ページ一覧（左）＋ ページ編集（右）の左右分割 */}
      <div className={pageDetailOpen ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start" : ""}>

      {/* ── 左：ページ一覧 ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
        {sortedPages.length === 0 ? <div className="text-center text-gray-300 py-10 text-sm">ページがありません。「＋ ページを追加」から作成してください。</div>
          : sortedPages.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-2 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${pageEdit && pageEdit.id === p.id && p.id !== 0 ? "bg-red-50" : ""}`}>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => movePage(i, -1)} disabled={i === 0} title="上へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
                <button onClick={() => movePage(i, 1)} disabled={i === sortedPages.length - 1} title="下へ"
                  className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{p.name} <span className="text-[11px] text-gray-400">（{p.abbr}）</span></div>
                <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-500">{contents.filter((c) => c.pageId === p.id).length} 件</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${p.isExternal ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{p.isExternal ? "外部公開" : "会員のみ"}</span>
                  <TargetTags attrIds={p.attrIds} mode={p.attrMode} index={index} />
                  <span>{p.createdAt ? p.createdAt.slice(0, 10) : ""}</span>
                </div>
              </div>
              <button onClick={() => copyPageUrl(p.publicToken)} disabled={!p.publicToken} title={pagePublicUrl(p.publicToken) || "公開URL未発行"}
                className="shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-30">URLコピー</button>
              <button onClick={() => togglePagePub(p)} title="公開/非公開" className={`relative w-10 h-[21px] rounded-full shrink-0 ${p.published ? "bg-green-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${p.published ? "left-[21px]" : "left-0.5"}`} />
              </button>
              <button onClick={() => duplicatePage(p)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 shrink-0">複写</button>
              <button onClick={() => openPageEdit(p)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
            </div>
          ))}
      </div>

      {/* ── 右：ページ編集パネル（画面外クリックでは閉じない）── */}
      {pageEdit && (
      <div className="lg:sticky lg:top-4 self-start min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => setPageEdit(null)} title="ページ一覧へ戻る" className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0">‹</button>
                <h2 className="font-bold text-gray-800 truncate">{pageEdit.id ? "ページを編集" : "ページを追加"}</h2>
              </div>
              <div className="flex items-center gap-3">
                {pageEdit.id ? (
                  <button onClick={() => togglePagePub(pageEdit)} title="公開/非公開" className="inline-flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold ${pageEdit.published ? "text-green-600" : "text-gray-400"}`}>{pageEdit.published ? "公開中" : "非公開"}</span>
                    <span className={`relative w-10 h-[21px] rounded-full ${pageEdit.published ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${pageEdit.published ? "left-[21px]" : "left-0.5"}`} />
                    </span>
                  </button>
                ) : null}
                <button onClick={() => setPageEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div><label className="text-xs font-bold text-gray-500 block mb-1">登録日時 <span className="text-gray-400 font-normal">自動</span></label>
                <input className={`${input} bg-gray-50 text-gray-500`} value={fmt(pageEdit.createdAt)} readOnly /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">ページ名 <span className="text-red-500">*</span></label>
                <input className={input} value={pageEdit.name} onChange={(e) => setPageEdit({ ...pageEdit, name: e.target.value })} /></div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">ページ名略称 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">タブに表示</span></label>
                <input className={input} value={pageEdit.abbr} onChange={(e) => setPageEdit({ ...pageEdit, abbr: e.target.value })} /></div>

              {/* 概要：会員のコンテンツ画面で、タブの下・抽出項目の上に表示される */}
              <div><label className="text-xs font-bold text-gray-500 block mb-1">概要 <span className="text-gray-400 font-normal">任意・会員のタブ下に表示されます</span></label>
                <textarea className={`${input} min-h-[72px]`} value={pageEdit.overview}
                  onChange={(e) => setPageEdit({ ...pageEdit, overview: e.target.value })}
                  placeholder="このページについての説明（例：7月のウェビナー参加者向けの特典ページです）" /></div>

              {/* ページ公開URL：新規登録時にDBが自動発行し、以後変更不可（/p/{token}） */}
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">公開URL（ページ全体） <span className="text-gray-400 font-normal">自動発行・編集不可</span></label>
                {pageEdit.publicToken ? (
                  <div className="flex gap-2">
                    <input className={`${input} bg-gray-100 text-gray-600 font-mono text-[12.5px]`}
                      value={pagePublicUrl(pageEdit.publicToken)} readOnly
                      onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" onClick={() => copyPageUrl(pageEdit.publicToken)}
                      className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">コピー</button>
                    <a href={pagePublicUrl(pageEdit.publicToken)} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">開く ↗</a>
                  </div>
                ) : (
                  <input className={`${input} bg-gray-50 text-gray-400 italic border-dashed`}
                    value="保存すると自動で発行されます" readOnly />
                )}
                <p className="text-[11px] text-gray-400 mt-1.5">ページ全体（概要＋配下の閲覧可能なコンテンツ一覧）を1つのURLで共有します。フォームのサンクスURLにも指定できます。以降は変更・削除できません。</p>
              </div>

              {/* 会員ポータル内のURL（ログイン必須。公開URLとは別物） */}
              <UrlField label="会員ポータルURL" hint="ログインが必要・公開対象の会員のみ閲覧可"
                path={pageEdit.id ? `/content?p=${pageEdit.id}` : ""} />

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">必須</span></label>

                {/* 全員に公開する：ONなら属性指定なしで全員に公開（初期OFF） */}
                <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${pagePublishAll ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600"
                    checked={pagePublishAll}
                    onChange={(e) => { const on = e.target.checked; setPagePublishAll(on); if (on) setPageEdit({ ...pageEdit, attrIds: [] }); }} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${pagePublishAll ? "text-emerald-800" : "text-gray-700"}`}>全員に公開する</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${pagePublishAll ? "text-emerald-700" : "text-gray-500"}`}>
                      属性の指定なしで、対象ロール全員に公開します。
                    </span>
                  </span>
                </label>

                {!pagePublishAll && (
                  <div className="mt-2.5">
                    <AttrTable tree={tree} index={index} value={pageEdit.attrIds}
                      onChange={(ids) => setPageEdit({ ...pageEdit, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
                    <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                      <select className={`${input} bg-white`} value={pageEdit.attrMode} onChange={(e) => setPageEdit({ ...pageEdit, attrMode: e.target.value as PublishMode })}>
                        {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select></div>
                    {pageEdit.attrIds.length === 0 && (
                      <p className="text-[11px] text-red-600 mt-1.5">
                        ⚠ 属性を1つ以上指定するか、「全員に公開する」にチェックしてください
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 外部公開：ONなら公開URLを知る全員が未ログインでページ全体を閲覧可（属性条件は無視） */}
              <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${pageEdit.isExternal ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600"
                  checked={pageEdit.isExternal} onChange={(e) => setPageEdit({ ...pageEdit, isExternal: e.target.checked })} />
                <span className="min-w-0">
                  <span className={`text-sm font-bold ${pageEdit.isExternal ? "text-emerald-800" : "text-gray-700"}`}>外部公開</span>
                  <span className={`block text-[11px] leading-relaxed mt-0.5 ${pageEdit.isExternal ? "text-emerald-700" : "text-gray-500"}`}>
                    ONにすると、上の公開対象属性に関わらず<b>公開URLを知っている人は誰でもログイン不要でページ全体を閲覧</b>できます。
                    OFFのときは会員のみ・属性条件どおりの出し分けになります。
                  </span>
                </span>
              </label>
              {pageEdit.isExternal && (
                <p className="text-[11px] text-gray-400 mt-1.5">
                  ※ 公開対象属性・公開条件は、会員ポータル側の一覧表示にのみ適用されます。<br />
                  ※ 公開トグル（ヘッダ／一覧の緑スイッチ）がOFFの場合は、外部公開ONでも公開URLは404になります。
                </p>
              )}
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
      </div>
      )}
    </div>
  );
}
