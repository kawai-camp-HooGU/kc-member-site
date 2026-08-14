"use client";
// ============================================================
// コンテンツ掲載画面（会員向け）
//
//   構成：コンテンツハブ → ドリルダウン（案E）
//     1) ハブ（?p= なし）：閲覧可能なページをカード一覧で表示。
//        未視聴が残る先頭ページを「続きから」注目カードとして大きく見せる。
//        ページが増えても縦に伸びるだけで破綻しない。全体進捗リング付き。
//     2) ページ内（?p=<id>）：そのページのコンテンツ一覧。上部に
//        「← コンテンツ一覧へ」戻る導線。種別／未視聴のみフィルタ、
//        横長マガジンカード、左端の進捗マーカー、「次はこれ」強調。
//     3) 詳細（/content/<id>）：本文・動画・資料。戻ると元のページへ。
//
//   ※ 以前の横スクロールタブは廃止（ページ増加で見落とし・押しづらさが出るため）。
//
//   視聴状況は content_views（engagement）から。再生位置は保持していないため
//   「視聴済／未視聴」の2値で表現する（途中再開は非対応）。
// ============================================================
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useMaster } from "../../hooks/useMaster";
import { useRoute } from "../../hooks/useRoute";
import { buildPath, withQuery } from "../../lib/routes";
import { fetchContentData, canView, toEmbedUrl, toImageUrl, THUMB_ASPECT } from "../../lib/contents";
import { recordContentView, fetchContentViews } from "../../lib/engagement";
import { fmtJst, fmtJstDate } from "../../lib/dateFmt";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { ContentPage, CmsContent, ContentKind } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { Icon } from "../common/Icon";
import { ThumbFrame } from "./ThumbFrame";
import { DoorPage } from "./DoorPage";
import { isDoorHtmlEmpty } from "../../lib/doorPage";
import { DocViewer } from "./DocViewer";
import { VideoPlayer } from "./VideoPlayer";
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
const fmtDate = (iso: string) => (iso ? fmtJstDate(iso).replace(/-/g, ".") : "");

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

// ── ページのカバー画像 ────────────────────────────────────────
//   ハブ（コンテンツ一覧）で各ページをカード表示する際のカバー。
//   coverUrl があれば <img>（ThumbFrame）で 16:9 表示。失敗・未設定は
//   ブランド赤の既定カバー（ページ略称入り）にフォールバックする。
function PageCover({ page, big = false }: { page: ContentPage; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [page.coverUrl]);
  const url = page.coverUrl ? toImageUrl(page.coverUrl) : "";

  if (url && !broken) {
    return (
      <ThumbFrame src={url} big={big} className="w-full" style={{ aspectRatio: THUMB_ASPECT }}
        onBroken={() => setBroken(true)} />
    );
  }
  return (
    <div className="relative flex items-center justify-center overflow-hidden w-full"
      style={{ aspectRatio: THUMB_ASPECT, background: "linear-gradient(135deg,#e11d2a,#7f1620)" }}>
      <span className="absolute left-2.5 top-2 text-[10px] font-black tracking-wide text-white/85">▲ KAWAI CAMP</span>
      <span className="text-white font-black text-center px-4 leading-snug" style={{ fontSize: big ? 20 : 15 }}>
        {page.abbr || page.name}
      </span>
    </div>
  );
}

// ── ハブ：注目カード（続きから）────────────────────────────────
//   未視聴が残る先頭ページを大きく見せ、学習の再開を促す。
function PageHubFeatured({
  page, total, viewed, onOpen,
}: { page: ContentPage; total: number; viewed: number; onOpen: () => void }) {
  const pct = total ? Math.round((viewed / total) * 100) : 0;
  const hasProgress = viewed > 0;
  const ex = page.overview?.trim();
  return (
    <article onClick={onOpen}
      className="group cursor-pointer bg-white rounded-2xl border-2 border-red-600 shadow-sm hover:shadow-xl transition-all overflow-hidden flex flex-col sm:flex-row">
      <div className="relative sm:w-72 sm:shrink-0">
        <PageCover page={page} big />
        <span className="absolute left-0 top-0 text-[10px] font-extrabold text-white px-3 py-1 rounded-br-xl bg-red-600">
          {hasProgress ? "続きから" : "まずはここから"}
        </span>
      </div>
      <div className="p-5 flex-1 flex flex-col justify-center min-w-0">
        <h3 className="text-[18px] font-black text-neutral-900 leading-snug">{page.name}</h3>
        {ex && <p className="mt-1.5 text-[12.5px] text-gray-500 leading-relaxed line-clamp-2">{ex}</p>}
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <span className="block h-full rounded-full bg-red-600" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 text-[11.5px] font-bold text-gray-400">全{total}本 ・ {viewed}本完了（{pct}%）</div>
        </div>
        <span className="mt-4 inline-flex items-center gap-1.5 self-start px-4 py-2 rounded-lg bg-red-600 text-white text-[12.5px] font-bold group-hover:bg-red-700 transition-colors">
          {hasProgress ? "続ける" : "見る"} →
        </span>
      </div>
    </article>
  );
}

// ── ハブ：通常のページカード ──────────────────────────────────
function PageHubCard({
  page, total, viewed, onOpen,
}: { page: ContentPage; total: number; viewed: number; onOpen: () => void }) {
  const done = total > 0 && viewed >= total;
  const ex = page.overview?.trim();
  return (
    <article onClick={onOpen}
      className="group cursor-pointer bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all overflow-hidden flex flex-col">
      <PageCover page={page} />
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-[15px] font-extrabold text-neutral-900 leading-snug group-hover:text-red-600 transition-colors">{page.name}</h3>
        {ex && <p className="mt-1 text-[12px] text-gray-500 leading-relaxed line-clamp-2 flex-1">{ex}</p>}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-[11.5px] font-bold">
          <span className="text-gray-400">{total}本</span>
          {total > 0 && (done
            ? <span className="text-emerald-600 inline-flex items-center gap-1"><Icon name="check" size={13} stroke={3} />すべて視聴済</span>
            : <span className="text-gray-400">・ 未視聴 {total - viewed}件</span>)}
          <span className="ml-auto text-red-600">開く →</span>
        </div>
      </div>
    </article>
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
  const { members, permission, contentSections } = useMaster();
  const router = useRouter();
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(() => members.find((m) => m.id === permission.myId)?.attrIds ?? [], [members, permission.myId]);

  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  // ── 画面状態は URL（固定URL化）＋ セクション（入口）──
  //    /content/{sec}          … セクションのハブ
  //    /content/{sec}?p=3      … ページ内一覧
  //    /content/{sec}/12?p=3   … 詳細（戻ると ?p=3 のページ一覧へ）
  //  ※ セクション未導入（未移行）時は従来 URL（/content/{contentId}）にフォールバック。
  const route = useRoute();
  const hasSections = contentSections.length > 0;
  const defaultSection = useMemo(
    () => contentSections.find((s) => s.isDefault) ?? contentSections[0] ?? null,
    [contentSections]
  );
  const sectionParam = route.detail[0] ?? null;   // 文字列 or null（bare /content）
  const curSection = hasSections
    ? (sectionParam
        ? contentSections.find((s) => String(s.id) === sectionParam) ?? null
        : defaultSection)
    : null;
  // 詳細の contentId：セクションありは detail[1]、なし（従来）は detail[0]
  const detailId = hasSections
    ? (route.detail[1] ? Number(route.detail[1]) : null)
    : (route.detail[0] ? Number(route.detail[0]) : null);
  const pageId = route.qNum("p");
  const setPageId = (id: number | null) => route.setQuery({ p: id });
  // セクションのパスセグメント（詳細URLの前に付ける）
  const secSeg: (string | number)[] = curSection ? [curSection.id] : [];
  // 詳細の開閉。所属ページ(pid)を ?p= に載せて、戻ったときに元のページ一覧へ帰す。
  const setDetailId = (id: number | null, pid?: number | null) =>
    route.go("content", id == null ? [...secSeg] : [...secSeg, id], { p: (pid ?? pageId) ?? undefined });
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

  // 現在のセクションに属するページだけに絞る（セクション未導入なら全件）。
  //   section_id 未設定（移行漏れ）のページは既定セクション扱いにする。
  const sectionPages = useMemo(() => {
    if (!hasSections) return visiblePages;
    if (!curSection) return [];
    return visiblePages.filter((p) => (p.sectionId ?? defaultSection?.id ?? null) === curSection.id);
  }, [visiblePages, hasSections, curSection, defaultSection]);

  /** ページ内で「その人が見られる公開コンテンツ」（フィルタ適用前） */
  const itemsOf = useMemo(() => (pid: number) =>
    contents.filter((c) => c.pageId === pid && c.published && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, index)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [contents, seeAll, myAttrs, index]
  );

  // URL正規化：bare /content や不正なセクションIDは、既定（または閲覧可の先頭）セクションへ寄せる。
  useEffect(() => {
    if (!hasSections) return;
    if (!curSection) {
      if (defaultSection) router.replace(buildPath(route.zone, "content", [defaultSection.id]));
      return;
    }
    if (sectionParam == null) router.replace(buildPath(route.zone, "content", [curSection.id]));
  }, [hasSections, curSection, sectionParam, defaultSection, route.zone, router]);

  // pageId 未指定＝ハブ（コンテンツ一覧）を表示する。ここでは自動選択しない。
  // 指定された pageId が現在のセクションに無い（切替後など）ならハブへ戻す。
  useEffect(() => {
    if (pageId != null && sectionPages.length && !sectionPages.some((p) => p.id === pageId)) setPageId(null);
  }, [sectionPages, pageId]);

  // 視聴ログ：詳細を開いたら記録（初回=登録／2回目以降=最終視聴日時・回数を更新）
  useEffect(() => {
    if (detailId == null) return;
    recordContentView(detailId);
    setViewed((prev) => (prev.has(detailId) ? prev : new Set(prev).add(detailId)));
  }, [detailId]);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;
  // セクション導入済みで、現在のセクションが解決できない（不正ID/権限外）→ リダイレクト待ちの間の保険表示
  if (hasSections && !curSection) return <p className="text-sm text-gray-400 py-10 text-center">コンテンツを読み込んでいます…</p>;
  if (visiblePages.length === 0) return <p className="text-sm text-gray-400 py-10 text-center">閲覧できるコンテンツページがありません。</p>;

  const detail = detailId != null ? contents.find((c) => c.id === detailId) ?? null : null;

  // ── 詳細画面 ──────────────────────────────────────────────
  if (detail) {
    const page = pages.find((p) => p.id === detail.pageId);
    const body = detail.noneMode === "html" ? detail.bodyHtml.trim() : detail.bodyText.trim();
    return (
      <div>
        <button onClick={() => setDetailId(null, detail.pageId)}
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
            <p className="text-xs text-gray-400 mb-5">登録日時：{fmtJst(detail.createdAt)}</p>

            {/* 動画：アップロード（署名URL）を優先。無ければ従来の埋め込みURL。 */}
            {detail.kind === "video" && (detail.filePath
              ? <VideoPlayer contentId={detail.id} title={detail.name} />
              : detail.url
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

  // ── ハブ（セクションのコンテンツ一覧）画面 ─────────────────
  //   ?p= が無いときは、現在のセクションに属するページをカード一覧で見せる。
  if (pageId == null) {
    const statOfId = (pid: number) => {
      const items = itemsOf(pid);
      return { total: items.length, viewed: items.filter((c) => viewed.has(c.id)).length };
    };
    const statOf = (p: ContentPage) => statOfId(p.id);
    // 未視聴が残る先頭ページを「続きから」注目カードにする
    const featured = sectionPages.find((p) => { const s = statOf(p); return s.total > 0 && s.viewed < s.total; }) ?? null;
    const rest = sectionPages.filter((p) => p.id !== featured?.id);
    const totalAll = sectionPages.reduce((n, p) => n + statOf(p).total, 0);
    const viewedAll = sectionPages.reduce((n, p) => n + statOf(p).viewed, 0);
    const secName = curSection?.name ?? "コンテンツ";
    const secOverview = curSection?.overview?.trim();

    // ── 扉ページ ────────────────────────────────────────────
    //   door_mode が html / hybrid かつ中身があるときだけ扉を描画する。
    //   ⚠️ 中身が空なら auto へフォールバックする（真っ白なハブを出さない）。
    //   ⚠️ ヘッダ（名称・概要・進捗リング）は扉の対象外。常に自動描画のまま。
    const doorHtml = curSection?.doorHtml ?? "";
    const useDoor = (curSection?.doorMode === "html" || curSection?.doorMode === "hybrid")
      && !isDoorHtmlEmpty(doorHtml);
    // 扉に載せ忘れたページへも到達できるよう、hybrid ではカード一覧も併記する。
    const showCards = !useDoor || curSection?.doorMode === "hybrid";

    return (
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        <header className="px-5 sm:px-7 pt-6 pb-5 border-b border-gray-200 bg-white">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-2xl font-black tracking-tight text-neutral-900">{secName}</h2>
              <p className="text-[12.5px] text-gray-400 mt-1">見たいページを選んでください</p>
            </div>
            <span className="flex-1" />
            <ProgressRing viewed={viewedAll} total={totalAll} />
          </div>
          {secOverview && <p className="text-[12.5px] text-gray-500 leading-relaxed mt-3 whitespace-pre-wrap">{secOverview}</p>}
        </header>
        <div className="px-5 sm:px-7 py-6 bg-gray-50/60 space-y-4">
          {sectionPages.length === 0 && (
            <div className="text-center text-gray-300 py-14 text-sm">このセクションに公開中のページはありません</div>
          )}
          {useDoor && (
            <DoorPage
              html={doorHtml}
              ctx={{
                // ⚠️ canView 済みのページだけを渡す。扉側で権限判定をやり直さない。
                pages: sectionPages,
                statOf: statOfId,
                resume: featured,
                hrefOf: (pid) => withQuery(buildPath(route.zone, "content", [...secSeg]), { p: pid }),
              }}
              onOpenPage={setPageId}
            />
          )}
          {showCards && (
            <>
              {featured && (() => { const s = statOf(featured); return (
                <PageHubFeatured page={featured} total={s.total} viewed={s.viewed} onOpen={() => setPageId(featured.id)} />
              ); })()}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rest.map((p) => {
                  const s = statOf(p);
                  return <PageHubCard key={p.id} page={p} total={s.total} viewed={s.viewed} onOpen={() => setPageId(p.id)} />;
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 一覧（掲載）画面 ──────────────────────────────────────
  const page = sectionPages.find((p) => p.id === pageId) ?? sectionPages[0];
  if (!page) return <p className="text-sm text-gray-400 py-10 text-center">このセクションに公開中のページはありません。</p>;
  const all = itemsOf(page.id);
  const nextId = all.find((c) => !viewed.has(c.id))?.id ?? null;   // 未視聴の先頭＝「次はこれ」
  const viewedCount = all.filter((c) => viewed.has(c.id)).length;

  const shown = all.filter((c) => (kind === "all" || c.kind === kind) && (!unviewedOnly || !viewed.has(c.id)));

  const filterBtn = (on: boolean) =>
    `px-3 py-1.5 rounded-md text-[11.5px] font-bold transition-colors ${on ? "bg-neutral-900 text-white" : "text-gray-500 hover:text-gray-800"}`;

  return (
    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
      {/* ヘッダ（ページ内。上部にハブへ戻る導線） */}
      <header className="px-5 sm:px-7 pt-5 pb-4 border-b border-gray-200 bg-white">
        <button onClick={() => { setPageId(null); setKind("all"); setUnviewedOnly(false); }}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-gray-400 hover:text-red-600 transition-colors mb-3">
          ← {curSection?.name ?? "コンテンツ"}一覧へ
        </button>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-2xl font-black tracking-tight text-neutral-900 truncate">{page.name}</h2>
            <p className="text-[12.5px] text-gray-400 mt-1">動画・資料・記事をここから閲覧できます</p>
          </div>
          <span className="flex-1" />
          <div className="pb-1"><ProgressRing viewed={viewedCount} total={all.length} /></div>
        </div>
      </header>

      {/* 概要（このページについて）：ヘッダと抽出項目の間に表示。設定＞ページ編集の「概要」より */}
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
              onOpen={() => setDetailId(c.id, page.id)} />
          ))
        )}
      </div>
    </div>
  );
}
