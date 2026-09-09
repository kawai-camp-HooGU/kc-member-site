"use client";
// ============================================================
// ホーム（会員ポータル）— REQ-094
//
//   固定レイアウトをやめ、「運営が組んだブロックの並びを上から描く器」にした。
//   ホームは2枚ある：メンバー用 と 外部用。見る人のロールで自動的に決まる。
//
//   ブロックを出すかどうかの判定は lib/homeBlocks.ts の isBlockVisible() 1つに閉じている。
//   ここでは「見えるブロックを並べる」ことと「必要な素材だけ取りに行く」ことだけをする。
//
//   ⚠️ ホームからは record_content_view を呼ばない。
//      サムネイルが見えただけで視聴済みにしてはいけない（全員の未視聴が消える）。
//      ただしカードの遷移先が embed 設定のページだと、ContentView 側が
//      ページを開いた時点で配下全件を記録する（REQ-061 の既存仕様）。
//      そのため棚のカードは「コンテンツ詳細」へ直接飛ばしている（設計書 §11-11＝a）。
//
//   ブロック定義が取れないとき（マイグレーション未適用など）は
//   fallbackBlocks() に倒して、改修前と同じ「大タイル＋お知らせ」を出す。
//   ホームが白紙になるのが一番まずいため。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import { useRoute } from "../../hooks/useRoute";
import { fetchNews, visibleNews } from "../../lib/news";
import { fetchContentData } from "../../lib/contents";
import { fetchContentViews } from "../../lib/engagement";
import {
  fetchEvents, fetchFormBriefs, fetchAnsweredMembers, buildFormDeadlines,
  visibleEvents, dayKey,
} from "../../lib/events";
import type { FormDeadline } from "../../lib/events";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { renderBodyHtml } from "../../lib/richText";
import { errMessage } from "../../lib/errors";
import {
  fetchHomeBlocks, fallbackBlocks, isBlockVisible, homeAudienceFor, seenIdsOf,
} from "../../lib/homeBlocks";
import type { HomePool } from "../../lib/homeBlocks";
import { HeroBlock } from "../home/HeroBlock";
import { ShelfBlock } from "../home/ShelfBlock";
import { LauncherBlock } from "../home/LauncherBlock";
import { NewsBlock } from "../home/NewsBlock";
import { EventBlock } from "../home/EventBlock";
import { HtmlBlock } from "../home/HtmlBlock";
import { Icon } from "../common/Icon";
import { CARD } from "../../lib/constants";
import type {
  NewsItem, NewsCategory, CalEvent, HomeBlock, HomeAudience, CmsContent, ContentPage,
} from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";

interface Props {
  onOpen?: (k: string) => void;
  /** サイドバーと同じ未読数（app.tsx の useChatUnread） */
  chatUnread?: number;
}

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ",     cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス", cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント",     cls: "bg-emerald-50 text-emerald-600" },
};
const bodyHtml = (n: NewsItem) => renderBodyHtml(n.bodyMode, n.bodyText, n.bodyHtml);
const fmt = (s: string) => (s ? s.replace("T", " ") : "—");

export function HomeView({ onOpen, chatUnread = 0 }: Props) {
  const { members, permission, can } = useMaster();
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(
    () => members.find((m) => m.id === permission.myId)?.attrIds ?? [],
    [members, permission.myId],
  );

  const route = useRoute();
  // お知らせ詳細は URL に載せる（/news/12）。一覧はホーム（/）。
  const detailId = route.view === "news" && route.detail[0] ? Number(route.detail[0]) : null;
  const openNews = (id: number) => route.go("news", [id]);
  const closeNews = () => route.go("home");

  const [blocks, setBlocks] = useState<HomeBlock[] | null>(null);
  const [tree, setTree] = useState<AttrNode[] | null>(null);
  const [pool, setPool] = useState<HomePool | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [openForms, setOpenForms] = useState<FormDeadline[]>([]);
  const [warn, setWarn] = useState("");

  // ── ① ブロック定義と属性ツリー（並行）──────────────────
  useEffect(() => {
    (async () => {
      const [b, t] = await Promise.allSettled([fetchHomeBlocks(), loadAttributeTree()]);
      if (b.status === "fulfilled") {
        setBlocks(b.value);
      } else {
        // テーブルが無い／取得に失敗 → 改修前と同じレイアウトへ倒す
        console.warn("ホームのブロック定義を取得できませんでした:", b.reason);
        setBlocks(null);
      }
      setTree(t.status === "fulfilled" ? t.value : []);
    })();
  }, []);

  const idx = useMemo(() => buildAttrIndex(tree ?? []), [tree]);

  // ── ② 見る人がどちらのホームを見るか ────────────────────
  const viewAs: HomeAudience = homeAudienceFor(permission.role);

  // ── ③ 見えるブロック（判定は isBlockVisible に閉じている）──
  const visible = useMemo(() => {
    if (tree == null) return [];                       // 属性ロード前は1つも描かない
    const src = blocks ?? fallbackBlocks(viewAs);
    const now = Date.now();
    return src
      .filter((b) => isBlockVisible(b, { role: viewAs, seeAll, myAttrs, idx, now }))
      .sort((a, z) => a.sortOrder - z.sortOrder || a.id - z.id);
  }, [blocks, tree, viewAs, seeAll, myAttrs, idx]);

  // ── ④ 見えるブロックが決まってから、必要な素材だけ取る ──
  const needs = useMemo(() => ({
    // hero/continue/shelf/ranking は contents+pages+views を共有（何本あっても取得は1回）
    // launcher は「未視聴 N件」のバッジで contents を使う
    contents: visible.some((b) => ["hero", "continue", "shelf", "ranking", "launcher"].includes(b.kind)),
    news:     visible.some((b) => b.kind === "news"),
    events:   visible.some((b) => ["event", "launcher"].includes(b.kind)),
    // launcher の「申込・回答」タイルは forms が要る
    forms:    visible.some((b) => b.kind === "launcher"),
  }), [visible]);

  useEffect(() => {
    if (tree == null) return;
    (async () => {
      const errs: string[] = [];
      if (needs.contents && can("content")) {
        try {
          const [{ pages, contents }, views] = await Promise.all([
            fetchContentData(), fetchContentViews(),
          ]);
          setPool({ pages, contents, views });
        } catch (e) { errs.push(errMessage(e, "コンテンツを取得できませんでした")); }
      }
      if (needs.news && can("news_view")) {
        try { setNews(await fetchNews()); }
        catch (e) { errs.push(errMessage(e, "お知らせを取得できませんでした")); }
      }
      if (needs.events && can("calendar")) {
        try {
          const [ev, forms, answered] = await Promise.all([
            fetchEvents(), needs.forms ? fetchFormBriefs() : Promise.resolve([]),
            needs.forms ? fetchAnsweredMembers() : Promise.resolve(new Map<number, Set<number>>()),
          ]);
          setEvents(ev);
          if (needs.forms) {
            const myEvents = visibleEvents(ev, myAttrs, idx, seeAll);
            const today = new Date().toISOString().slice(0, 10);
            const dl = buildFormDeadlines(forms, myEvents, answered, permission.myId);
            setOpenForms(
              dl.filter((d) => !d.answered && d.day >= today)
                .sort((a, b) => a.day.localeCompare(b.day)),
            );
          }
        } catch (e) { errs.push(errMessage(e, "予定を取得できませんでした")); }
      }
      // 取れた分はそのまま表示し、失敗は上部に赤帯1本で知らせる（brand.md §4）
      setWarn(errs.join(" ／ "));
    })();
  }, [needs, tree, can, myAttrs, idx, seeAll, permission.myId]);

  // ── ⑤ 各ブロックへ渡す派生データ ──────────────────────
  const newsList = useMemo(
    () => visibleNews(news, myAttrs, idx, seeAll), [news, myAttrs, idx, seeAll],
  );
  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return visibleEvents(events, myAttrs, idx, seeAll)
      .filter((e) => dayKey(e.endAt || e.startAt) >= today)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [events, myAttrs, idx, seeAll]);
  const seen = useMemo(
    () => seenIdsOf(pool?.views ?? [], permission.myId), [pool, permission.myId],
  );
  /** 未視聴コンテンツ数（ショートカットのバッジ） */
  const unviewed = useMemo(() => {
    if (!pool) return 0;
    const okPages = new Set(
      pool.pages.filter((p) => p.published).map((p) => p.id),
    );
    return pool.contents.filter(
      (c) => c.published && okPages.has(c.pageId) && !seen.has(c.id),
    ).length;
  }, [pool, seen]);

  // ── ⑥ 遷移 ────────────────────────────────────────────
  //   コンテンツ詳細へ直接飛ばす（embed ページ経由にすると配下全件が視聴済みになる）
  const openContent = (c: CmsContent, page: ContentPage | undefined): void => {
    const sec = page?.sectionId;
    const seg: (string | number)[] = sec != null ? [sec, c.id] : [c.id];
    route.go("content", seg, { p: c.pageId });
  };
  const openSection = (sectionId: number): void => route.go("content", [sectionId]);
  const openPage = (p: ContentPage): void =>
    route.go("content", p.sectionId != null ? [p.sectionId] : [], { p: p.id });
  const openMore = (b: HomeBlock): void => {
    if (b.sourceMode === "page" && b.sourcePageId != null) {
      const p = pool?.pages.find((x) => x.id === b.sourcePageId);
      if (p) { openPage(p); return; }
    }
    if (b.sourceMode === "section" && b.sourceSectionId != null) {
      openSection(b.sourceSectionId); return;
    }
    onOpen?.("content");
  };

  // ── お知らせ詳細（/news/12）──────────────────────────
  const detail = detailId != null ? news.find((n) => n.id === detailId) ?? null : null;
  if (detail) {
    return (
      <div className="max-w-3xl mx-auto">
        <button onClick={closeNews}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200
                     bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">
          ← ホームへ戻る
        </button>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {detail.important && (
              <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200
                               rounded-full px-2 py-0.5">重要</span>
            )}
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${CATS[detail.category].cls}`}>
              {CATS[detail.category].label}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold mb-1.5">{detail.title}</h1>
          <p className="text-xs text-gray-400 mb-5">公開日時：{fmt(detail.publishedAt)}</p>
          <div className="text-[15px] leading-8 text-gray-700 content-rich"
            dangerouslySetInnerHTML={{ __html: bodyHtml(detail) }} />
        </div>
      </div>
    );
  }

  // ── ブロックの描画 ────────────────────────────────────
  const railKinds = new Set(["news", "event"]);
  const main = visible.filter((b) => !(railKinds.has(b.kind) && b.config.rail));
  const rail = visible.filter((b) => railKinds.has(b.kind) && b.config.rail);

  const render = (b: HomeBlock, compact = false) => {
    switch (b.kind) {
      case "hero":
        return pool ? (
          <HeroBlock key={b.id} block={b} pool={pool} myId={permission.myId}
            myAttrs={myAttrs} idx={idx} seeAll={seeAll} seen={seen}
            onOpen={openContent} onOpenSection={openSection} onOpenPage={openPage} />
        ) : null;
      case "continue":
      case "shelf":
      case "ranking":
        return pool ? (
          <ShelfBlock key={b.id} block={b} pool={pool} myId={permission.myId}
            myAttrs={myAttrs} idx={idx} seeAll={seeAll}
            onOpen={openContent} onMore={openMore} />
        ) : null;
      case "launcher":
        return (
          <LauncherBlock key={b.id} block={b} myId={permission.myId} can={can}
            unviewed={unviewed} chatUnread={chatUnread}
            openForms={openForms.length} firstFormSlug={openForms[0]?.slug ?? null}
            onOpen={(k) => onOpen?.(k)} />
        );
      case "news":
        return <NewsBlock key={b.id} block={b} items={newsList} onOpen={openNews} compact={compact} />;
      case "event":
        return <EventBlock key={b.id} block={b} items={upcoming} onOpen={() => onOpen?.("calendar")} />;
      case "html":
        return <HtmlBlock key={b.id} block={b} />;
      default:
        return null;                     // 未知の kind はスキップ（前方互換）
    }
  };

  // 読み込み中：枠だけ先に確定させ、行がずれないようにする（brand.md §4）
  const loading = tree == null;

  return (
    <div>
      {warn && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700
                        text-[13px] font-bold px-4 py-2.5">
          {warn}
        </div>
      )}

      <div className={rail.length > 0 ? "grid grid-cols-1 lg:grid-cols-[1fr_268px] gap-5" : ""}>
        <div className="min-w-0">
          {loading
            ? <div className="h-[280px] rounded-2xl bg-gray-100 animate-none" aria-hidden />
            : main.map((b) => render(b))}
          {!loading && main.length === 0 && rail.length === 0 && <EmptyHome canSet={seeAll} onOpen={onOpen} />}
        </div>
        {rail.length > 0 && (
          <div className="min-w-0">{rail.map((b) => render(b, true))}</div>
        )}
      </div>
    </div>
  );
}

/**
 * すべてのブロックが空のときだけ出す（brand.md §4 ②型：前提が未設定）。
 * 個々のブロックは0件なら黙って消えるが、画面ごと空になるのは知らせる必要がある。
 */
function EmptyHome({ canSet, onOpen }: { canSet: boolean; onOpen?: (k: string) => void }) {
  return (
    <div className={`${CARD} p-8 text-center`}>
      <span className="w-12 h-12 rounded-xl bg-red-50 text-red-600 mx-auto mb-3
                       flex items-center justify-center">
        <Icon name="home" size={22} />
      </span>
      <p className="text-[15px] font-bold text-gray-800 m-0 mb-1">
        表示できるものがまだありません
      </p>
      <p className="text-[13px] text-gray-500 m-0 mb-4">
        {canSet
          ? "ホームに表示するブロックが1つも設定されていません。"
          : "事務局がコンテンツを追加すると、ここに表示されます。"}
      </p>
      <button onClick={() => onOpen?.(canSet ? "contentset" : "content")}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white
                   text-[14px] font-bold hover:bg-red-700">
        {canSet ? "ホーム設定を開く" : "コンテンツを見る"}
      </button>
    </div>
  );
}
