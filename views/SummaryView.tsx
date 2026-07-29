"use client";
// ============================================================
// サマリー（コミュニケーション＞対応）
//   ポータルトーク／メール／LINE を横断した「登録者・友だち数」と「トーク未対応数」を集約表示する。
//   各行クリックで該当チャネルのトーク画面へ遷移（未対応で絞り込む想定）。
//
//   ⚠️ 表示値は暫定（サンプル）。LINE・メール連携の実装後に実データへ接続する。
//      置換ポイントは `// TODO(data)` を参照。データ取得は hooks/ 側に集約し、本ビューは表示のみに保つ。
// ============================================================
import { Icon } from "../components/common/Icon";

// ── ドメイン型（実データ接続時もこの形を維持する） ──
interface MailAccount { address: string; desc: string; unhandled: number }
interface LineAccount { name: string; desc: string; friends: number; unhandled: number }

// TODO(data): 実データに差し替え（例：usePortalTalkSummary / useMailAccounts / useLineAccounts）
const PORTAL = { registrants: 1240, unhandled: 8 };
const MAILS: MailAccount[] = [
  { address: "support@kawaicamp.jp", desc: "サポート窓口", unhandled: 5 },
  { address: "info@kawaicamp.jp",    desc: "総合受付",     unhandled: 2 },
  { address: "sales@kawaicamp.jp",   desc: "申込・営業",   unhandled: 0 },
];
const LINES: LineAccount[] = [
  { name: "KAWAI CAMP 公式",    desc: "メインアカウント", friends: 3420, unhandled: 12 },
  { name: "KAWAI CAMP サポート", desc: "サポート専用",     friends: 890,  unhandled: 3 },
];

const jpNum = (n: number) => n.toLocaleString("ja-JP");

// 未対応バッジ（0件は淡色）
function UnhandledBadge({ n }: { n: number }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[26px] h-[24px] px-2 rounded-full text-sm font-extrabold ${n > 0 ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}`}>
      {n}
    </span>
  );
}

export function SummaryView({ onOpen }: { onOpen: (k: string) => void }) {
  const totalUnhandled =
    PORTAL.unhandled + MAILS.reduce((s, m) => s + m.unhandled, 0) + LINES.reduce((s, l) => s + l.unhandled, 0);
  const totalFriends = LINES.reduce((s, l) => s + l.friends, 0);

  return (
    // 大枠をウィンドウ高さに自動フィット。本文だけ内部スクロール。
    <div className="h-[calc(100dvh-3rem)] flex flex-col w-full">
      {/* 見出し */}
      <div className="shrink-0 mb-4">
        <div className="text-xs text-slate-500">運営メニュー › <span className="text-slate-700 font-medium">対応</span> › サマリー</div>
        <h1 className="text-2xl font-bold text-slate-800 mt-1">サマリー</h1>
        <p className="text-sm text-slate-500">ポータルトーク・メール・LINE を横断した対応状況の一覧</p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
      {/* 暫定表示の注記 */}
      <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        ※ 表示値は暫定（サンプル）です。LINE・メール連携の実装後に実データへ接続します。
      </div>

      {/* KPI */}
      <div className="flex gap-3.5 flex-wrap mb-2">
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">未対応 合計</div>
          <div className="text-2xl font-extrabold text-red-600 mt-0.5">{jpNum(totalUnhandled)}<span className="text-xs font-semibold text-slate-500 ml-0.5">件</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">全チャネル横断</div>
        </div>
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">ポータルトーク 登録者</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{jpNum(PORTAL.registrants)}<span className="text-xs font-semibold text-slate-500 ml-0.5">人</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">アクティブ会員</div>
        </div>
        <div className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-[11.5px] text-slate-500 font-semibold">LINE 友だち 合計</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{jpNum(totalFriends)}<span className="text-xs font-semibold text-slate-500 ml-0.5">人</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{LINES.length}アカウント</div>
        </div>
      </div>

      {/* ポータルトーク */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg bg-red-600 text-white flex items-center justify-center"><Icon name="chat" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">ポータルトーク</h2>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => onOpen("chat")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
            <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500 to-red-700 text-white flex items-center justify-center shrink-0"><Icon name="chat" size={18} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-slate-800">ポータルトーク</span>
              <span className="block text-[11.5px] text-slate-500">会員ポータル内トーク</span>
            </span>
            <span className="flex items-center gap-5">
              <span className="text-right"><span className="block text-[17px] font-extrabold text-slate-800 leading-none">{jpNum(PORTAL.registrants)}</span><span className="block text-[10px] text-slate-500 mt-1">登録者</span></span>
              <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={PORTAL.unhandled} /></span>
              <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
            </span>
          </button>
        </div>
      </section>

      {/* メールアカウント */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg bg-slate-600 text-white flex items-center justify-center"><Icon name="mail" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">メールアカウント</h2>
          <span className="text-[11.5px] text-slate-500 font-semibold">{MAILS.length}アカウント</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {MAILS.map((m) => (
            <button key={m.address} onClick={() => onOpen("mail")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
              <span className="w-9 h-9 rounded-lg bg-slate-500 text-white flex items-center justify-center shrink-0"><Icon name="mail" size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{m.address}</span>
                <span className="block text-[11.5px] text-slate-500">{m.desc}</span>
              </span>
              <span className="flex items-center gap-5">
                <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={m.unhandled} /></span>
                <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* LINEアカウント */}
      <section className="mt-5">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="w-[26px] h-[26px] rounded-lg text-white flex items-center justify-center" style={{ background: "#06c755" }}><Icon name="chat" size={16} /></span>
          <h2 className="text-[15px] font-bold text-slate-800">LINEアカウント</h2>
          <span className="text-[11.5px] text-slate-500 font-semibold">{LINES.length}アカウント</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {LINES.map((l) => (
            // TODO(nav): LINEトーク画面の実装後に該当ビューへ遷移。暫定でトーク（chat）へ。
            <button key={l.name} onClick={() => onOpen("chat")} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors group">
              <span className="w-9 h-9 rounded-lg text-white flex items-center justify-center shrink-0" style={{ background: "#06c755" }}><Icon name="chat" size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{l.name}</span>
                <span className="block text-[11.5px] text-slate-500">{l.desc}</span>
              </span>
              <span className="flex items-center gap-5">
                <span className="text-right"><span className="block text-[17px] font-extrabold text-slate-800 leading-none">{jpNum(l.friends)}</span><span className="block text-[10px] text-slate-500 mt-1">友だち</span></span>
                <span className="text-center"><span className="block text-[10px] text-slate-500 mb-1">未対応</span><UnhandledBadge n={l.unhandled} /></span>
                <span className="text-slate-300 text-lg group-hover:text-red-600 transition-colors">›</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="text-[11.5px] text-slate-500 mt-4">
        各行クリックで該当チャネル／アカウントのトーク画面（未対応で絞り込み）へ遷移します。
      </p>
      </div>
    </div>
  );
}
