"use client";
// ============================================================
// コンテンツ掲載画面（会員向け）
//
//   デザイン：案B×案E 混合
//     ・ヘッダ一体型タブ（下線式・横スクロール）＋ 完了率リング
//     ・横長マガジンカード（大きめサムネ＋本文抜粋2行）
//     ・左端の進捗マーカー（✓＝視聴済／番号＝未視聴）と「次はこれ」強調
//     ・種別フィルタ／未視聴のみフィルタ
//
//   視聴状況は content_views（engagement）から。再生位置は保持していないため
//   「視聴済／未視聴」の2値で表現する（途中再開は非対応）。
// ============================================================
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMaster } from "../../hooks/useMaster";
import { useRoute } from "../../hooks/useRoute";
import { fetchContentData, canView, toEmbedUrl, toImageUrl, THUMB_ASPECT } from "../../lib/contents";
import { recordContentView, fetchContentViews } from "../../lib/engagement";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { ContentPage, CmsContent, ContentKind } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { Icon } from "../common/Icon";
import { ThumbFrame } from "./ThumbFrame";
import { DocViewer } from "./DocViewer";
import { renderBodyHtml } from "../../lib/richText";
import { PushOptIn } from "../common/PushOptIn";

type KindFilter = "all" | ContentKind;

const KIND_LABEL: Record<ContentKind, string> = { video: "動画", doc: "資料", none: "記事" };
const KIND_PILL: Record<ContentKind, string> = {
  video: "bg-red-600 text-white",
  doc: "bg-indigo-100 text-indigo-700",
  none: "bg-emerald-100 text-emerald-700",
};
const SEEN_LABEL: Record<ContentKind, [string, string]> = {   // [未, 済]
  video: ["未視聴", "視聴済"],
  doc: ["未読", "既読"],
  none: ["未読", "閲覧済"],
};

/** 本文（テキスト or HTML）から一覧用の抜粋を作る */
function excerpt(c: CmsContent, max = 90): string {
  const raw = c.noneMode === "html" ? c.bodyHtml.replace(/<[^>]*>/g, " ") : c.bodyText;
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
const fmtDate = (iso: string) => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "");

// ── サムネ ────────────────────────────────────────────────────
//   thumbUrl があれば <img> で表示する。
//   ⚠️ 以前は background-image を使っていたが、CSSの背景画像は
//      読み込みに失敗しても何も起きない（＝ただの白い箱になる）。
//      404・直リンク禁止・http混在ブロックのときに原因が分からなくなるため、
//      <img> + onError で「失敗したら種別の既定サムネにフォールバック」する。
//
//   【表示ルール（一覧・詳細・公開ページで共通）】
//     推奨サイズ：16:9 / 1280×720px（lib/contents.ts の THUMB_HINT 参照）
//     枠は 16:9 に統一し、画像は「必ず全体を表示」する（切り抜かない）。
//     余白はぼかし帯＋本体の角丸・影で埋める。実装は ThumbFrame を参照。
function Thumb({
  c, className = "", big = false, fluid = false, style,
}: { c: CmsContent; className?: string; big?: boolean; fluid?: boolean; style?: CSSProperties }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [c.thumbUrl]);

  if (c.thumbUrl && !broken) {
    return (
      <ThumbFrame src={toImageUrl(c.thumbUrl)} big={big} fluid={fluid} className={className} style={style}
        onBroken={() => setBroken(true)} />
    );
  }

  // サムネ未設定・読み込み失敗時の既定サムネ。fluid でも高さが要るので 16:9 を与える。
  const fallbackStyle: CSSProperties = fluid ? { aspectRatio: THUMB_ASPECT, ...style } : (style ?? {});

  // 既定サムネ（種別ごと）。記事は白飛びしないよう塗り＋濃いアイコンにする。
  const bg =
    c.kind === "video" ? "linear-gradient(135deg,#17171b,#3a0a0e)"
    : c.kind === "doc" ? "linear-gradient(135deg,#2b2b31,#111)"
    : "linear-gradient(135deg,#c7d2fe,#e0e7ff)";
  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`} style={{ ...fallbackStyle, background: bg }}>
      {c.kind === "video" ? (
        <span className="rounded-full text-white flex items-center justify-center"
          style={{ background: "rgba(225,29,42,.92)", width: big ? 56 : 44, height: big ? 56 : 44 }}>
          <Icon name="content" size={big ? 24 : 20} />
        </span>
      ) : c.kind === "doc" ? (
        <span className="text-white"><Icon name="doc" size={big ? 34 : 28} /></span>
      ) : (
        <span className="rounded-2xl bg-white/70 text-indigo-600 flex items-center justify-center"
          style={{ width: big ? 56 : 46, height: big ? 56 : 46 }}>
          <Icon name="article" size={big ? 30 : 24} />
        </span>
      )}
      {/* サムネURLが設定されているのに読めなかった場合だけ、運営が気づけるよう小さく出す */}
      {c.thumbUrl && broken && (
        <span className="absolute left-2 bottom-2 text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-black/45 text-white">
          サムネ画像を読み込めません
        </span>
      )}
    </div>
  );
}

// ── 完了率リング ──────────────────────────────────────────────
function ProgressRing({ viewed, total }: { viewed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((viewed / total) * 100);
  const C = 2 * Math.PI * 15.5;
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="text-right leading-tight">
        <div className="text-[11px] text-gray-400 font-bold">このページの進捗</div>
        <div className="text-[13px] font-extrabold text-neutral-900">
          {viewed}<span className="text-gray-300"> / </span>{total}
          <span className="text-[11px] font-bold text-gray-400 ml-1">完了</span>
        </div>
      </div>
      <div className="relative w-11 h-11">
        <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f2f4" strokeWidth="4" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e11d2a" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-extrabold text-neutral-900">{pct}%</span>
      </div>
    </div>
  );
}

// ── 一覧カード ────────────────────────────────────────────────
function ContentCard({
  c, seen, stepNo, isNext, onOpen,
}: { c: CmsContent; seen: boolean; stepNo: number; isNext: boolean; onOpen: () => void }) {
  const [unLabel, seenLabel] = SEEN_LABEL[c.kind];
  const ex = excerpt(c);

  return (
    <article onClick={onOpen}
      className={`group flex flex-col sm:flex-row bg-white rounded-2xl overflow-hidden cursor-pointer transition-all
        ${isNext
          ? "border-2 border-red-600 shadow-md hover:shadow-xl relative"
          : "border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200"}`}>
      {isNext && (
        <span className="absolute right-0 top-0 z-10 text-[10px] font-extrabold text-white px-3 py-1 rounded-bl-xl bg-red-600">次はこれ</span>
      )}

      {/* 進捗マーカー（PCのみ） */}
      <div className={`hidden sm:flex w-11 shrink-0 flex-col items-center pt-6 ${isNext ? "bg-red-50/60" : "bg-white"}`}>
        {seen ? (
          <span className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Icon name="check" size={15} stroke={3} /></span>
        ) : isNext ? (
          <span className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center"><Icon name="content" size={13} /></span>
        ) : (
          <span className="w-7 h-7 rounded-full border-2 border-gray-200 text-gray-300 text-[11px] font-black flex items-center justify-center">{stepNo}</span>
        )}
        <span className={`flex-1 w-px mt-1.5 mb-2 ${isNext ? "bg-red-100" : "bg-gray-100"}`} />
      </div>

      {/* サムネ枠：16:9 固定（スマホ＝全幅／PC＝幅224px×126px・上下中央） */}
      <div className="relative shrink-0 w-full sm:w-56 sm:self-center sm:py-5 sm:pl-1">
        <Thumb c={c} className="w-full sm:rounded-xl" style={{ aspectRatio: THUMB_ASPECT }} />
        {/* スマホ用の視聴済バッジ */}
        {seen && (
          <span className="sm:hidden absolute left-2 top-2 text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">✓ {seenLabel}</span>
        )}
      </div>

      <div className="flex-1 min-w-0 p-5 sm:pr-6">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-full ${KIND_PILL[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${seen ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
            {seen ? seenLabel : unLabel}
          </span>
          <span className="text-[11px] text-gray-400">{fmtDate(c.createdAt)}</span>
        </div>
        <h3 className={`text-[16.5px] font-extrabold leading-snug text-neutral-900 mb-1 ${isNext ? "" : "group-hover:text-red-600"} transition-colors`}>
          {c.name}
        </h3>
        {ex && <p className="text-[12.5px] text-gray-500 leading-relaxed line-clamp-2">{ex}</p>}
        {isNext && (
          <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 text-white text-[12px] font-bold hover:bg-red-700">
            <Icon name="content" size={14} />{c.kind === "video" ? "視聴する" : "開く"}
          </span>
        )}
      </div>
    </article>
  );
}

// ── 本体 ──────────────────────────────────────────────────────
export function ContentView() {
  const { members, permission } = useMaster();
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(() => members.find((m) => m.id === permission.myId)?.attrIds ?? [], [members, permission.myId]);

  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  // ── 画面状態は URL（固定URL化）──
  //    /content/12 … 詳細   ・ /content?p=3 … ページタブ
  const route = useRoute();
  const detailId = route.detail[0] ? Number(route.detail[0]) : null;
  const setDetailId = (id: number | null) => route.go("content", id == null ? [] : [id]);
  const pageId = route.qNum("p");
  const setPageId = (id: number | null) => route.setQuery({ p: id });
  const [kind, setKind] = useState<KindFilter>("all");
  const [unviewedOnly, setUnviewedOnly] = useState(false);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    (async () => {
      try {
        const [{ pages, contents }, t, views] = await Promise.all([
          fetchContentData(), loadAttributeTree(), fetchContentViews(),
        ]);
        setPages(pages); setContents(contents); setTree(t);
        setViewed(new Set(views.filter((v) => v.memberId === permission.myId).map((v) => v.contentId)));
      } catch (e) { console.error("コンテンツ読込エラー:", e); }
      setLoading(false);
    })();
  }, [permission.myId]);

  const visiblePages = useMemo(
    () => pages.filter((p) => seeAll || canView(p.attrIds, p.attrMode, myAttrs, index))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [pages, seeAll, myAttrs, index]
  );

  /** ページ内で「その人が見られる公開コンテンツ」（フィルタ適用前） */
  const itemsOf = useMemo(() => (pid: number) =>
    contents.filter((c) => c.pageId === pid && c.published && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, index)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [contents, seeAll, myAttrs, index]
  );

  useEffect(() => {
    if (pageId == null && visiblePages.length) {
      // 空タブが初期選択されて「コンテンツがありません」に見えるのを防ぐ
      const firstWithContent = visiblePages.find((p) => itemsOf(p.id).length > 0);
      setPageId((firstWithContent ?? visiblePages[0]).id);
    }
    if (pageId != null && visiblePages.length && !visiblePages.some((p) => p.id === pageId)) setPageId(visiblePages[0].id);
  }, [visiblePages, pageId, itemsOf]);

  // 視聴ログ：詳細を開いたら記録（初回=登録／2回目以降=最終視聴日時・回数を更新）
  useEffect(() => {
    if (detailId == null) return;
    recordContentView(detailId);
    setViewed((prev) => (prev.has(detailId) ? prev : new Set(prev).add(detailId)));
  }, [detailId]);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;
  if (visiblePages.length === 0) return <p className="text-sm text-gray-400 py-10 text-center">閲覧できるコンテンツページがありません。</p>;

  const detail = detailId != null ? contents.find((c) => c.id === detailId) ?? null : null;

  // ── 詳細画面 ──────────────────────────────────────────────
  if (detail) {
    const page = pages.find((p) => p.id === detail.pageId);
    const body = detail.noneMode === "html" ? detail.bodyHtml.trim() : detail.bodyText.trim();
    return (
      <div>
        <button onClick={() => setDetailId(null)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">
          ← {page?.name ?? "一覧"}へ戻る
        </button>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* ヘッダー画像：幅100%・高さは画像なり（左右の余白ゼロ）。縦長は 480px で頭打ち。 */}
          <Thumb c={detail} big fluid className="border-b border-gray-100" />
          <div className="p-6">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${KIND_PILL[detail.kind]}`}>{KIND_LABEL[detail.kind]}</span>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{SEEN_LABEL[detail.kind][1]}</span>
            </div>
            <h2 className="text-xl font-extrabold mt-2.5 mb-2">{detail.name}</h2>
            <p className="text-xs text-gray-400 mb-5">登録日時：{detail.createdAt ? detail.createdAt.replace("T", " ").slice(0, 16) : "—"}</p>

            {detail.kind === "video" && (detail.url
              ? <div className="rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
                  <iframe src={toEmbedUrl(detail.url)} title={detail.name}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} />
                </div>
              : <p className="text-sm text-gray-400">動画URLが未設定です。</p>)}

            {/* 資料：アップロード（署名URL・ログあり）を優先。無ければ従来の外部URL埋め込み。 */}
            {detail.kind === "doc" && (detail.filePath
              ? <DocViewer contentId={detail.id} fileName={detail.fileName} fileSize={detail.fileSize} title={detail.name} />
              : detail.url
                ? <div>
                    <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 460 }}>
                      <iframe src={toEmbedUrl(detail.url)} title={detail.name} style={{ width: "100%", height: "100%", border: 0 }} />
                    </div>
                    <a href={detail.url} target="_blank" rel="noopener"
                      className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
                      <Icon name="external" size={16} /> 新しいタブで開く
                    </a>
                  </div>
                : <p className="text-sm text-gray-400">資料が未設定です。</p>)}

            {body && (
              <div className={`text-[15px] leading-8 text-gray-700 content-rich ${detail.kind !== "none" ? "mt-5" : ""}`}
                dangerouslySetInnerHTML={{ __html: renderBodyHtml(detail.noneMode, detail.bodyText, detail.bodyHtml) }} />
            )}

            {/*
              通知オプトイン：コンテンツを1本開いた「価値を感じた直後」に出す。
              来訪直後に出すと拒否されやすく、ブラウザの拒否は復活が困難なため。
            */}
            <PushOptIn memberId={permission.myId ?? null} />
          </div>
        </div>
      </div>
    );
  }

  // ── 一覧（掲載）画面 ──────────────────────────────────────
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0];
  const all = itemsOf(page.id);
  const nextId = all.find((c) => !viewed.has(c.id))?.id ?? null;   // 未視聴の先頭＝「次はこれ」
  const viewedCount = all.filter((c) => viewed.has(c.id)).length;

  const shown = all.filter((c) => (kind === "all" || c.kind === kind) && (!unviewedOnly || !viewed.has(c.id)));

  const filterBtn = (on: boolean) =>
    `px-3 py-1.5 rounded-md text-[11.5px] font-bold transition-colors ${on ? "bg-neutral-900 text-white" : "text-gray-500 hover:text-gray-800"}`;

  return (
    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
      {/* ヘッダ（タブ一体型） */}
      <header className="px-5 sm:px-7 pt-6 border-b border-gray-200 bg-white">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-2xl font-black tracking-tight text-neutral-900">コンテンツ</h2>
            <p className="text-[12.5px] text-gray-400 mt-1">動画・資料・記事をここから閲覧できます</p>
          </div>
          <span className="flex-1" />
          <div className="pb-1"><ProgressRing viewed={viewedCount} total={all.length} /></div>
        </div>

        <div className="flex gap-1 overflow-x-auto mt-5 -mb-px" style={{ scrollbarWidth: "none" }}>
          {visiblePages.map((p) => {
            const n = itemsOf(p.id).length;
            const on = p.id === page.id;
            return (
              <button key={p.id} onClick={() => { setPageId(p.id); setKind("all"); setUnviewedOnly(false); }}
                className={`relative px-4 py-3 text-[13.5px] font-bold whitespace-nowrap transition-colors ${on ? "text-neutral-900" : "text-gray-400 hover:text-gray-700"}`}>
                {p.abbr || p.name}
                <span className={`ml-1.5 text-[11px] font-extrabold px-1.5 py-0.5 rounded-full align-middle ${on ? "bg-red-600 text-white" : "bg-gray-100 text-gray-500"}`}>{n}</span>
                {on && <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-full bg-red-600" />}
              </button>
            );
          })}
        </div>
      </header>

      {/* 概要（このページについて）：タブと抽出項目の間に表示。設定＞ページ編集の「概要」より */}
      {page.overview?.trim() && (
        <div className="px-5 sm:px-7 pt-4">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-[11px] font-bold text-gray-400 mb-1">このページについて</div>
            <div className="text-[12.5px] text-gray-600 leading-relaxed whitespace-pre-wrap">{page.overview}</div>
          </div>
        </div>
      )}

      {/* ツールバー */}
      <div className="px-5 sm:px-7 py-4 flex items-center gap-3 flex-wrap bg-gray-50/60 border-b border-gray-100">
        <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
          {(["all", "video", "doc", "none"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={filterBtn(kind === k)}>
              {k === "all" ? "すべて" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-gray-500 cursor-pointer select-none">
          <input type="checkbox" className="w-3.5 h-3.5 accent-red-600"
            checked={unviewedOnly} onChange={(e) => setUnviewedOnly(e.target.checked)} />
          未視聴のみ
        </label>
        <span className="flex-1" />
        <span className="text-[11px] text-gray-400">全{all.length}件 ・ 未視聴 {all.length - viewedCount}件</span>
      </div>

      {/* 一覧 */}
      <div className="px-5 sm:px-7 py-6 space-y-3.5 bg-gray-50/60 min-h-[240px]">
        {all.length === 0 ? (
          <div className="text-center text-gray-300 py-14 text-sm">このページに公開中のコンテンツはありません</div>
        ) : shown.length === 0 ? (
          <div className="text-center text-gray-300 py-14 text-sm">条件に一致するコンテンツはありません</div>
        ) : (
          shown.map((c) => (
            <ContentCard key={c.id} c={c}
              seen={viewed.has(c.id)}
              stepNo={all.indexOf(c) + 1}
              isNext={c.id === nextId}
              onOpen={() => setDetailId(c.id)} />
          ))
        )}
      </div>
    </div>
  );
}
