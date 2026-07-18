"use client";
// ============================================================
// ホーム（会員ポータル）
//
//   デザイン：案H「大タイル・ランチャー型」
//     ・やりたいことを大きなタイルで選ばせる（押し間違えない・迷わない）
//     ・タイルには「未視聴 7件」「未読 2件」「次は 8/12」など"いま効く数字"をバッジで出す
//     ・お知らせはタイルの下にコンパクトに置く（詳細は /news/{id}）
//
//   バッジの元データはすべて既存のもの：
//     未視聴 … contents × content_views（engagement）
//     予定   … events（公開対象属性で出し分け）
//     未回答 … forms（カレンダー表示ON or イベント紐付け）× form_submissions
//     未読   … useChatUnread（app.tsx から props で受け取る）
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import { useRoute } from "../../hooks/useRoute";
import { fetchNews, visibleNews } from "../../lib/news";
import { fetchContentData, canView } from "../../lib/contents";
import { fetchContentViews } from "../../lib/engagement";
import { isSubscribed } from "../../lib/push";
import {
  fetchEvents, fetchFormBriefs, fetchAnsweredMembers, buildFormDeadlines,
  visibleEvents, eventRangeLabel, dayKey,
} from "../../lib/events";
import type { FormDeadline } from "../../lib/events";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { renderBodyHtml } from "../../lib/richText";
import type { NewsItem, NewsCategory, CalEvent } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";

interface Props {
  onOpen?: (k: string) => void;
  /** サイドバーと同じ未読数（app.tsx の useChatUnread） */
  chatUnread?: number;
}

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ", cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス", cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント", cls: "bg-emerald-50 text-emerald-600" },
};
const bodyHtml = (n: NewsItem) => renderBodyHtml(n.bodyMode, n.bodyText, n.bodyHtml);
const fmt = (s: string) => (s ? s.replace("T", " ") : "—");
const mmdd = (day: string) => {
  const [, m, d] = (day || "").split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : "";
};

// ── 大タイル ──────────────────────────────────────────────────
interface TileProps {
  icon: IconName;
  title: string;
  desc: string;
  /** 右上の丸バッジ（0 なら出さない） */
  badge?: number;
  /** タイル下部の一言（未視聴が7件、次は8/12 … ） */
  note?: string;
  tone: "red" | "teal" | "neutral" | "blue";
  onClick: () => void;
}

const TONE = {
  red:     { icon: "bg-red-50 text-red-600",         badge: "bg-red-600",     note: "text-red-600",     ring: "hover:border-red-300",     card: "bg-white border-gray-200" },
  teal:    { icon: "bg-teal-50 text-teal-600",       badge: "bg-teal-600",    note: "text-teal-700",    ring: "hover:border-teal-300",    card: "bg-white border-gray-200" },
  neutral: { icon: "bg-neutral-100 text-neutral-700", badge: "bg-neutral-900", note: "text-neutral-700", ring: "hover:border-neutral-400", card: "bg-white border-gray-200" },
  blue:    { icon: "bg-white text-blue-600",         badge: "bg-blue-600",    note: "text-blue-600",    ring: "hover:border-blue-400",    card: "bg-blue-50 border-blue-200" },
} as const;

function Tile({ icon, title, desc, badge = 0, note, tone, onClick }: TileProps) {
  const t = TONE[tone];
  return (
    <button onClick={onClick}
      className={`relative text-left border-2 rounded-2xl p-5 sm:p-6 transition-all hover:shadow-md ${t.card} ${t.ring}`}>
      {badge > 0 && (
        <span className={`absolute right-4 top-4 min-w-[26px] h-[26px] px-1.5 rounded-full text-white text-[13px] font-black flex items-center justify-center ${t.badge}`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <span className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 ${t.icon}`}>
        <Icon name={icon} size={26} />
      </span>
      <div className="text-[17px] font-black text-gray-900">{title}</div>
      <div className="text-[12.5px] text-gray-500 mt-0.5">{desc}</div>
      {note && <div className={`text-[11.5px] font-bold mt-1.5 ${t.note}`}>{note}</div>}
    </button>
  );
}

// ── 本体 ──────────────────────────────────────────────────────
export function HomeView({ onOpen, chatUnread = 0 }: Props) {
  const { members, permission, can } = useMaster();
  const name = permission.myName || "ようこそ";
  const seeAll = permission.role === "admin" || permission.role === "leader";
  const myAttrs = useMemo(() => members.find((m) => m.id === permission.myId)?.attrIds ?? [], [members, permission.myId]);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [unviewed, setUnviewed] = useState(0);
  const [nextEvent, setNextEvent] = useState<CalEvent | null>(null);
  const [openForms, setOpenForms] = useState<FormDeadline[]>([]);
  // 初期設定カード：この端末が通知未設定（未購読）のときだけ表示する。
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => { (async () => { try { setShowSetup(!(await isSubscribed())); } catch { /* 対応外環境は表示のまま */ setShowSetup(true); } })(); }, []);

  // お知らせ詳細は URL に載せる（/news/12）。一覧はホーム（/）。
  const route = useRoute();
  const detailId = route.view === "news" && route.detail[0] ? Number(route.detail[0]) : null;
  const openNews = (id: number) => route.go("news", [id]);
  const closeNews = () => route.go("home");

  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    (async () => {
      try {
        const [n, t] = await Promise.all([fetchNews(), loadAttributeTree()]);
        setNews(n); setTree(t);
      } catch (e) { console.error("お知らせ読込エラー:", e); }
    })();
  }, []);

  // タイルのバッジ（未視聴／次の予定／未回答フォーム）
  useEffect(() => {
    if (tree.length === 0 && myAttrs.length > 0) return;   // 属性ツリーの読み込み待ち
    (async () => {
      try {
        const idx = buildAttrIndex(tree);
        const today = new Date().toISOString().slice(0, 10);

        // ── 未視聴コンテンツ ──
        if (can("content")) {
          const [{ pages, contents }, views] = await Promise.all([fetchContentData(), fetchContentViews()]);
          const okPages = new Set(
            pages.filter((p) => seeAll || canView(p.attrIds, p.attrMode, myAttrs, idx)).map((p) => p.id),
          );
          const mine = contents.filter(
            (c) => c.published && okPages.has(c.pageId) && (seeAll || canView(c.attrIds, c.attrMode, myAttrs, idx)),
          );
          const seen = new Set(views.filter((v) => v.memberId === permission.myId).map((v) => v.contentId));
          setUnviewed(mine.filter((c) => !seen.has(c.id)).length);
        }

        // ── 次の予定・未回答フォーム ──
        if (can("calendar")) {
          const [events, forms, answered] = await Promise.all([
            fetchEvents(), fetchFormBriefs(), fetchAnsweredMembers(),
          ]);
          const myEvents = visibleEvents(events, myAttrs, idx, seeAll);
          const upcoming = myEvents
            .filter((e) => dayKey(e.endAt || e.startAt) >= today)
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          setNextEvent(upcoming[0] ?? null);

          const deadlines = buildFormDeadlines(forms, myEvents, answered, permission.myId);
          setOpenForms(deadlines.filter((d) => !d.answered && d.day >= today).sort((a, b) => a.day.localeCompare(b.day)));
        }
      } catch (e) { console.error("ホームの集計エラー:", e); }
    })();
  }, [tree, myAttrs, seeAll, permission.myId, can]);

  const list = useMemo(() => visibleNews(news, myAttrs, index, seeAll), [news, myAttrs, index, seeAll]);
  const detail = detailId != null ? news.find((n) => n.id === detailId) ?? null : null;
  const unread = list.filter((n) => n.important).length;   // 「重要」の件数をお知らせバッジに使う

  // ── お知らせ詳細（/news/12）──
  if (detail) {
    return (
      <div>
        <button onClick={closeNews} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">← ホームへ戻る</button>
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

  const firstForm = openForms[0] ?? null;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-black text-neutral-900 mb-1">こんにちは、{name} さん</h1>
      <p className="text-[13px] text-gray-500 mb-5">やりたいことを選んでください。</p>

      {/* 初期設定カード（通知が未設定のときだけ表示。設定完了で自動的に消える） */}
      {showSetup && (
        <button onClick={() => onOpen?.("tutorial")}
          className="w-full text-left flex items-center gap-3.5 bg-white border border-red-100 border-l-4 border-l-red-600 rounded-2xl px-4 py-4 mb-4 hover:shadow-md transition-all">
          <span className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Icon name="settings" size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-black text-gray-900">初期設定</span>
            <span className="block text-[12px] text-gray-500 mt-0.5">アプリのインストールと通知をオンにして、お知らせを見逃さないようにしましょう。</span>
          </span>
          <span className="ml-auto text-red-600 shrink-0 text-lg">›</span>
        </button>
      )}

      {/* ── 大タイル ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {can("content") && (
          <Tile icon="content" tone="red"
            title="コンテンツ" desc="動画・資料を見る"
            badge={unviewed}
            note={unviewed > 0 ? `未視聴が ${unviewed}件` : "すべて視聴済みです"}
            onClick={() => onOpen?.("content")} />
        )}

        {can("calendar") && (
          <Tile icon="calendar" tone="teal"
            title="カレンダー" desc="予定・イベントを見る"
            note={nextEvent ? `次は ${eventRangeLabel(nextEvent).split(" ")[0]} ${nextEvent.title}` : "直近の予定はありません"}
            onClick={() => onOpen?.("calendar")} />
        )}

        {can("chat") && (
          <Tile icon="chat" tone="neutral"
            title="チャット" desc="事務局に相談する"
            badge={chatUnread}
            note={chatUnread > 0 ? `未読が ${chatUnread}件` : "新しいメッセージはありません"}
            onClick={() => onOpen?.("chat")} />
        )}

        {/* 申込・回答はカレンダー連携フォームなので、カレンダー機能がONのロールにだけ出す */}
        {can("calendar") && firstForm && (
          <Tile icon="form" tone="blue"
            title="申込・回答" desc="フォームに回答する"
            badge={openForms.length}
            note={`未回答 ${openForms.length}件（期限 ${mmdd(firstForm.day)}）`}
            onClick={() => window.open(`/f/${firstForm.slug}`, "_blank", "noopener")} />
        )}
      </div>

      {/* ── お知らせ ──
          他画面の一覧カード（コンテンツ・フォーム等）と装飾を揃える。
          ・角丸は rounded-xl（ここだけ 2xl で、隣のタイルとリズムが合っていなかった）
          ・見出しはチャコール（.tbl-head と同じ地色）
          ・行は px-4 py-3・text-sm font-bold */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2 bg-[#3f3f46] text-zinc-100">
          <span className="text-[12px] font-bold inline-flex items-center gap-1.5">
            <Icon name="news" size={15} /> お知らせ
          </span>
          {unread > 0 && (
            <span className="text-[10px] font-bold text-white bg-red-600 rounded-full px-1.5 py-0.5">{unread}</span>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-zinc-400">{list.length} 件</span>
        </div>

        {list.length === 0 ? (
          <div className="text-center text-gray-300 py-10 text-sm">お知らせはありません</div>
        ) : list.slice(0, 5).map((n, i) => (
          <div key={n.id} onClick={() => openNews(n.id)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-800 truncate">{n.title}</div>
              <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-0.5">
                {n.important && <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">重要</span>}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CATS[n.category].cls}`}>{CATS[n.category].label}</span>
                <span>{n.publishedAt ? n.publishedAt.slice(0, 10) : ""}</span>
              </div>
            </div>
            <span className="text-gray-300 shrink-0 text-lg">›</span>
          </div>
        ))}
      </div>
    </div>
  );
}
