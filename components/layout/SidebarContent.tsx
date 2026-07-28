"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import type { Permission } from "../../hooks/usePermission";
import { useMaster } from "../../hooks/useMaster";
import { LogoMark } from "./LogoMark";
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import type { Zone } from "../../lib/zone";
import { isOpsView, isOpsRole, OPS_ROOT, MEMBER_ROOT } from "../../lib/zone";
import { buildPath } from "../../lib/routes";

export interface SidebarContentProps {
  view: string;
  /** 現在の view より後ろのパスセグメント先頭（例：/ops/master/news → "news"）。設定内タブのハイライト用。 */
  subview?: string;
  onSelect: (k: string) => void;
  permission: Permission;
  user: User | null;
  userInitial: string;
  onSignOut: () => void;
  onNavigate?: () => void;
  chatUnread?: number;
  /** LINEトークの未読（顧客発・未確認）総数。 */
  lineUnread?: number;
  /** 入り口（Phase 2）。"ops" のときだけ運営メニューを出す。 */
  zone?: Zone;
}

//   href … 設定内のマスタ画面（/ops/master/{tab}）へのリンク。指定時は view 遷移でなく直接 push。
//   hidden … サイドバーに表示しない（非表示）。実体（ビュー/マスタ）は残すので後で戻せる。
interface NavItem { key: string; label: string; jp: string; icon: IconName; feature?: string; href?: string; hidden?: boolean }
//   運営2ペインの「左カテゴリ列」も兼ねる。icon/jp は左カテゴリボタンの表示に使う。
//   catLines … 左カテゴリ列でのラベルを明示的に複数行で出したいときに使う（例：["ポータル","トーク"]）。未指定なら jp を1行表示。
interface NavGroup { id: string; label: string; jp: string; icon: IconName; items: NavItem[]; catLines?: string[] }

// 設定ハブから「サイドバーへ昇格」したタブ。これらに居るときは設定(master)を非アクティブにする。
const PROMOTED_TABS = new Set<string>(["member", "content", "source", "news", "event", "welcome"]);

// ── トップ（グループ外・最上部／会員ゾーンの現行表示用） ──
const TOP: NavItem[] = [
  { key: "home", label: "Home", jp: "ホーム", icon: "home", feature: "home" },
];

// ── 会員メニュー（案1）：コミュニティ → ロードマップ → その他 ──
//   id/label に加え、2ペインの左カテゴリ用に icon/jp（短縮ラベル）を持たせる。
const MEMBER_GROUPS: NavGroup[] = [
  { id: "community", label: "Community", jp: "コミュ", icon: "content", items: [
    { key: "content",  label: "Content",  jp: "コンテンツ", icon: "content",  feature: "content" },
    { key: "calendar", label: "Calendar", jp: "カレンダー", icon: "calendar", feature: "calendar" },
    { key: "chat",     label: "Chat",     jp: "チャット",   icon: "chat",     feature: "chat" },
  ]},
  { id: "roadmap", label: "Roadmap", jp: "進行", icon: "board", items: [
    { key: "dashboard", label: "Dashboard", jp: "ダッシュボード", icon: "dashboard", feature: "dashboard" },
    { key: "kanban",    label: "Board",     jp: "カンバン",       icon: "board",     feature: "kanban" },
    { key: "gantt",     label: "Timeline",  jp: "ガント",         icon: "timeline",  feature: "gantt" },
    { key: "bulkadd",   label: "Bulk Add",  jp: "一括登録",       icon: "bulk",      feature: "bulk_register" },
  ]},
  { id: "other", label: "Other", jp: "その他", icon: "bell", items: [
    { key: "notification", label: "Notifications", jp: "通知設定", icon: "bell", feature: "notification" },
    { key: "help",         label: "Help",          jp: "ヘルプ",   icon: "help", feature: "help" },
  ]},
];

// ── 運営メニュー（案2フロー順）：集客 → 配信 → 顧客 → 決済 → コミュニティ管理 → 設定 ──
//   href 付き（流入経路・初回メッセージ・お知らせ・イベント・メンバー）は設定内マスタタブへのリンク。
const OPS_GROUPS: NavGroup[] = [
  { id: "acq", label: "Form", jp: "フォーム", icon: "form", items: [
    { key: "form",   label: "Form",   jp: "フォーム",   icon: "form",  feature: "form" },
    { key: "source", label: "Source", jp: "流入経路",   icon: "globe", feature: "set_source", href: "/ops/master/source", hidden: true },
  ]},
  { id: "delivery", label: "Delivery", jp: "配信", icon: "broadcast", items: [
    { key: "broadcast", label: "Broadcast", jp: "一斉配信",     icon: "broadcast", feature: "broadcast" },
    { key: "scenario",  label: "Scenario",  jp: "シナリオ配信", icon: "scenario",  feature: "scenario" },
    { key: "welcome",   label: "Welcome",   jp: "初回メッセージ", icon: "chat",    feature: "set_welcome", href: "/ops/master/welcome" },
  ]},
  { id: "payment", label: "Payment", jp: "決済", icon: "doc", items: [
    { key: "payments", label: "Payments", jp: "決済", icon: "doc", feature: "payment_manage" },
    { key: "refunds",  label: "Refunds",  jp: "返金・解約", icon: "doc", feature: "refund_manage" },
  ]},
  { id: "commmgmt", label: "Community Mgmt", jp: "管理", icon: "content", items: [
    { key: "contentset", label: "Content",   jp: "コンテンツ管理",   icon: "content",  feature: "content_manage" },
    { key: "news",       label: "News",      jp: "お知らせ",         icon: "news",     feature: "set_news",   href: "/ops/master/news" },
    { key: "event",      label: "Events",    jp: "イベント・予定",   icon: "calendar", feature: "event_manage", href: "/ops/master/event" },
    // ⚠️ 以前は feature: "chat" を流用していたため、チャットをOFFにすると
    //    ブックマークも巻き添えで消えていた。専用キーに分離済み。
    { key: "bookmarks",  label: "Bookmarks", jp: "ブックマーク",     icon: "book",     feature: "bookmarks" },
  ]},
  { id: "settings", label: "Settings", jp: "設定", icon: "settings", items: [
    { key: "master", label: "Settings", jp: "設定", icon: "settings", feature: "master" },
  ]},
];

// ── 運営2ペインの左カテゴリ ──
//   顧客：最上部に配置。子は「サマリー」（対応状況の集約）→「メンバー」の順。
const CUSTOMER_CAT: NavGroup = { id: "customer", label: "Customer", jp: "顧客", icon: "users", items: [
  { key: "summary",   label: "Summary",   jp: "サマリー", icon: "chart", feature: "chat" },
  { key: "customers", label: "Customers", jp: "顧客一覧", icon: "users", feature: "set_member", hidden: true },
  { key: "member",    label: "Member",    jp: "メンバー", icon: "users", feature: "set_member", href: "/ops/master/member" },
]};
//   Pトーク：会員ポータル内トーク（旧「トーク」）。子項目「ポータルトーク」＝chat ビューを流用。
const PTALK_CAT: NavGroup = { id: "talk", label: "Portal Talk", jp: "ポータルトーク", catLines: ["ポータル", "トーク"], icon: "headset", items: [
  { key: "chat", label: "Portal Talk", jp: "ポータルトーク", icon: "chat", feature: "chat" },
]};
//   LINE：公式アカウント連携。Pトークの隣に並べる。
const LINE_CAT: NavGroup = { id: "line", label: "LINE", jp: "LINE", icon: "messages", items: [
  { key: "line-accounts", label: "LINE Accounts", jp: "LINEアカウント", icon: "settings", feature: "line_account" },
  { key: "line",          label: "LINE Talk",     jp: "LINEトーク",     icon: "messages", feature: "line_chat" },
  { key: "line-friends",  label: "LINE Friends",  jp: "友だち一覧",     icon: "users",    feature: "line_friends" },
  { key: "line-match",    label: "Matching",      jp: "名寄せ",         icon: "shield",   feature: "line_match" },
  { key: "line-richmenu", label: "Rich Menu",     jp: "リッチメニュー", icon: "grid",     feature: "line_richmenu" },
]};
//   メール：メールアカウント連携。子は「アカウント一覧（接続管理）」と「Mailbox（受信対応）」。
const MAIL_CAT: NavGroup = { id: "mail", label: "Mail", jp: "メール", icon: "mail", items: [
  { key: "mail",        label: "Accounts", jp: "アカウント一覧", icon: "mail",  feature: "mail" },
  { key: "mailbox",     label: "Mailbox",  jp: "受信トレイ",     icon: "inbox", feature: "mailbox" },
  { key: "mailthreads", label: "Threads",  jp: "会話",           icon: "chat",  feature: "mailthreads" },
]};
// 左カテゴリの並び：顧客 → Pトーク → LINE → メール → 集客 → 配信 → 決済 → 管理 → 設定
const OPS_CATS: NavGroup[] = [CUSTOMER_CAT, PTALK_CAT, LINE_CAT, MAIL_CAT, ...OPS_GROUPS];

// サイドバー／ドロワー共通の中身
export function SidebarContent({ view, subview = "", onSelect, permission, user, userInitial, onSignOut, onNavigate, chatUnread = 0, lineUnread = 0, zone = "member" }: SidebarContentProps) {
  const { can } = useMaster();
  const router = useRouter();
  const isOpsZone = zone === "ops";

  const go = (k: string) => { onSelect(k); onNavigate && onNavigate(); };
  const goHref = (href: string) => { router.push(href); onNavigate && onNavigate(); };
  // ロール権限（can）に加えて、ゾーン外の運営メニューは出さない（Phase 2）
  const visible = (it: NavItem) =>
    !it.hidden && (!it.feature || can(it.feature)) && (isOpsZone || !isOpsView(it.key));
  // 項目のアクティブ判定（href付きマスタタブ・設定・通常 view を一括で扱う）
  const isActiveItem = (it: NavItem): boolean =>
    it.href        ? (view === "master" && subview === it.key)
    : it.key === "master" ? (view === "master" && !PROMOTED_TABS.has(subview))
    : view === it.key;
  // 運営ロールなら、もう一方のゾーンへの導線を出す（会員体験の確認／運営コンソールへの復帰）
  const showZoneSwitch = isOpsRole(permission.roleLabel);

  // 会員ゾーン用アコーディオンの開閉状態
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // 右ペインに表示するカテゴリ。空文字なら「現在地 or 先頭」を描画時に解決する。
  const [selCat, setSelCat] = useState<string>("");

  // ── 体感速度の改善 ──
  //   遷移は router.push（ミドルウェアの認証＋is_ops RPC ＋ RSC 往復）でラグが出る。
  //   ①クリックした項目を即ハイライト（pending）②ホバー/表示時に遷移先を先読みし往復を隠す。
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  useEffect(() => { setPendingKey(null); }, [view, subview]); // 遷移完了（URL変化）で解除
  const pathOf = (it: NavItem) => it.href ?? buildPath(zone, it.key);
  const prefetch = (it: NavItem) => { try { router.prefetch(pathOf(it)); } catch { /* noop */ } };

  // ops=true の行は運営専用マーク（赤アイコン＋右端の赤ドット）を付ける。
  const Item = ({ it, ops = false }: { it: NavItem; ops?: boolean }) => {
    const active = isActiveItem(it) || pendingKey === it.key;
    const badge = it.key === "chat" && chatUnread > 0 ? chatUnread
      : it.key === "line" && lineUnread > 0 ? lineUnread
      : 0;
    return (
      <button onMouseEnter={() => prefetch(it)}
        onClick={() => { setPendingKey(it.key); if (it.href) goHref(it.href); else go(it.key); }}
        className={`w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg transition-colors ${active ? "bg-red-600 text-white" : "text-slate-300 hover:bg-neutral-800"}`}>
        <span className={`w-[18px] flex items-center justify-center shrink-0 ${active ? "opacity-90" : ops ? "text-red-400" : "opacity-90"}`}><Icon name={it.icon} size={18} /></span>
        {/* 英語名（上）＋ 日本語名（下・一回り小さく）を縦積み。横幅不足でも日本語が縦組みにならない。 */}
        <span className="flex-1 min-w-0 flex flex-col text-left leading-tight">
          <span className="text-sm font-medium break-words">{it.label}</span>
          <span className={`text-[11px] break-words ${active ? "text-white/70" : "text-slate-500"}`}>{it.jp}</span>
        </span>
        {badge > 0 && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none ${active ? "bg-white text-red-600" : "bg-red-500 text-white"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {ops && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-white/80" : "bg-red-500"}`} />}
      </button>
    );
  };

  // 会員ゾーン（現行のまま）用アコーディオングループ
  const Group = ({ g }: { g: NavGroup }) => {
    const items = g.items.filter(visible);
    if (items.length === 0) return null;
    const isCol = !!collapsed[g.id];
    return (
      <div>
        <button onClick={() => toggleGroup(g.id)}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-extrabold tracking-wider uppercase text-slate-500 hover:text-slate-400">
          <span>{g.label}</span>
          <span className={`ml-auto text-[9px] transition-transform ${isCol ? "-rotate-90" : ""}`}>▼</span>
        </button>
        {!isCol && <div className="space-y-0.5">{items.map((it) => <Item key={it.key} it={it} />)}</div>}
      </div>
    );
  };

  // ── 運営2ペインの描画データ（権限で空になったカテゴリは落とす） ──
  const catViews = OPS_CATS
    .map((c) => ({ cat: c, items: c.items.filter(visible) }))
    .filter((x) => x.items.length > 0);
  const activeCat =
    catViews.find((x) => x.cat.id === selCat) ??
    catViews.find((x) => x.items.some(isActiveItem)) ??
    catViews[0];

  // 表示中カテゴリの項目は先読みしておく（ホバー前でも最初のクリックを温める）
  const activeCatId = activeCat?.cat.id;
  useEffect(() => {
    if (!isOpsZone || !activeCat) return;
    activeCat.items.forEach((it) => { try { router.prefetch(it.href ?? buildPath(zone, it.key)); } catch { /* noop */ } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpsZone, activeCatId, zone]);

  // ゾーン切替リンク（運営ロールのみ）
  const zoneSwitchLink = showZoneSwitch ? (
    <a href={isOpsZone ? MEMBER_ROOT : OPS_ROOT}
      className="w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-neutral-800 hover:text-white transition-colors">
      <span className="w-[18px] flex items-center justify-center shrink-0 opacity-90">
        <Icon name={isOpsZone ? "home" : "settings"} size={18} />
      </span>
      <span className="flex-1 text-left">{isOpsZone ? "Member View" : "OPS Console"}</span>
      <span className="text-[10px] text-slate-500">{isOpsZone ? "会員画面" : "運営"}</span>
    </a>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      {/* ── 固定：ロゴ ── */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-4">
        <LogoMark box="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight leading-none">
          <span className="text-white tracking-wide">KAWAI</span><span className="text-white tracking-wide"> CAMP</span>
          {isOpsZone && <span className="text-red-500 tracking-wide"> OPS</span>}
        </span>
      </div>

      {isOpsZone ? (
        /* ── 運営ゾーン：表示切替トグル ＋ 2ペイン ── */
        <>
          {/* 表示切替：運営メニュー（現在地）／会員視点（＝実際の会員画面へ遷移。旧 Member View を統合） */}
          <div className="shrink-0 mx-3 mb-2 p-0.5 flex gap-0.5 rounded-lg bg-black/40 border border-neutral-800">
            <span className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-bold bg-red-600 text-white">
              <Icon name="settings" size={14} />運営メニュー
            </span>
            <a href={MEMBER_ROOT}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white hover:bg-neutral-800 transition-colors">
              <Icon name="home" size={14} />会員視点
            </a>
          </div>

          {/* 2ペイン：左カテゴリ列 ＋ 右詳細ペイン */}
          <div className="flex-1 min-h-0 flex">
            {/* 左：カテゴリ列 */}
            <div className="w-[76px] shrink-0 overflow-y-auto sidebar-scroll px-1.5 py-1 border-r border-neutral-800 bg-black/20">
              {catViews.map(({ cat }) => {
                const on = activeCat?.cat.id === cat.id;
                const catBadge =
                  (cat.items.some((it) => it.key === "chat") ? chatUnread : 0) +
                  (cat.items.some((it) => it.key === "line") ? lineUnread : 0);
                return (
                  <button key={cat.id} onClick={() => setSelCat(cat.id)}
                    className={`relative w-full flex flex-col items-center gap-1 py-2 my-0.5 rounded-lg text-[10px] font-bold transition-colors ${on ? "bg-red-600 text-white" : "text-slate-400 hover:bg-neutral-800 hover:text-white"}`}>
                    <Icon name={cat.icon} size={19} />
                    {/* ラベルは2行指定(catLines)があればその通りに、無ければ jp を1行。全カテゴリで高さを揃える。 */}
                    <span className="flex flex-col items-center justify-center leading-none gap-0.5 min-h-[22px]">
                      {cat.catLines
                        ? cat.catLines.map((ln, i) => <span key={i}>{ln}</span>)
                        : <span>{cat.jp}</span>}
                    </span>
                    {catBadge > 0 && (
                      <span className="absolute top-1 right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                        {catBadge > 99 ? "99+" : catBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 右：詳細ペイン */}
            <div className="flex-1 min-w-0 overflow-y-auto sidebar-scroll px-2 py-1">
              {activeCat && (
                <>
                  <div className="px-2.5 pt-2 pb-1.5 flex items-baseline gap-2">
                    <span className="text-sm font-bold text-white">{activeCat.cat.label}</span>
                    <span className="text-[10px] text-slate-500">{activeCat.cat.jp}</span>
                  </div>
                  <div className="space-y-0.5">
                    {activeCat.items.map((it) => <Item key={it.key} it={it} ops />)}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        /* ── 会員ゾーン：現行のまま（アコーディオン） ── */
        <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
          <div className="px-2">
            {TOP.filter(visible).map((it) => <Item key={it.key} it={it} />)}
          </div>
          <nav className="px-2 mt-1 space-y-1">
            {MEMBER_GROUPS.map((g) => <Group key={g.id} g={g} />)}
          </nav>
          {zoneSwitchLink && <div className="px-2 pt-2 pb-2">{zoneSwitchLink}</div>}
        </div>
      )}

      {/* ── 固定：ログインアカウント ── */}
      <div className="shrink-0 px-3 py-3 border-t border-neutral-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-700 font-bold text-sm shrink-0">{userInitial}</div>
          <span className="text-xs text-slate-300 truncate flex-1">{user?.email}</span>
        </div>
        <button onClick={onSignOut} className="w-full text-xs text-slate-400 hover:text-white border border-neutral-700 rounded-lg py-1.5 transition-colors">Log out</button>
      </div>
    </div>
  );
}
