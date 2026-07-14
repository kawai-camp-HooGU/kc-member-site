"use client";
// ============================================================
// 「通知がブロックされている」ときの解除マニュアル（モーダル）
//
//   なぜアプリ側から直せないのか：
//     通知の許可／ブロックは **ブラウザが端末ごとに保存している設定** で、
//     Web ページ側から書き換えることはできない（できたら悪用され放題になる）。
//     一度「ブロック」を選ぶと、以後 subscribeDevice() を呼んでも
//     ダイアログすら出ず、即座に拒否される（permission === "denied"）。
//     → ユーザー自身にブラウザの設定を変えてもらうしかない。
//
//   ブラウザごとに手順が違うので、タブで出し分ける。
//   ⚠️ 現在のブラウザは UA から推測して初期選択する（外れても手で切り替えられる）。
// ============================================================
import { useState } from "react";
import type { ReactNode } from "react";

interface Props { onClose: () => void }

type Kind = "chrome" | "safari" | "edge" | "firefox" | "ios" | "android";

const TABS: { k: Kind; label: string }[] = [
  { k: "chrome",  label: "Chrome（PC）" },
  { k: "edge",    label: "Edge" },
  { k: "safari",  label: "Safari（Mac）" },
  { k: "firefox", label: "Firefox" },
  { k: "android", label: "Android" },
  { k: "ios",     label: "iPhone / iPad" },
];

/** UA から現在のブラウザを推測（初期タブ） */
function guessKind(): Kind {
  if (typeof navigator === "undefined") return "chrome";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Chrome\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "chrome";
}

/** ブラウザのアドレスバーを模した図 */
function AddressBar({ highlight }: { highlight: string }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-100">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
      </div>
      <div className="bg-white px-2.5 pb-2.5">
        <div className="flex items-center gap-2 border border-gray-300 rounded-full px-2.5 py-1.5 bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-red-100 border-2 border-red-500 grid place-items-center text-[11px] shrink-0">
            {highlight}
          </span>
          <span className="text-[11px] text-gray-500 font-mono truncate">kawaicamp-portal.vercel.app</span>
        </div>
      </div>
    </div>
  );
}

/** 設定パネルの図（項目リスト＋「許可」を選ばせる） */
function PanelFigure({ title, items, pick }: { title: string; items: string[]; pick: string }) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white p-3">
      <p className="text-[11px] font-bold text-gray-700 m-0 mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${
            it === pick
              ? "bg-red-50 border-2 border-red-400 text-red-700 font-bold"
              : "bg-gray-50 border border-gray-200 text-gray-500"}`}>
            <span>{it}</span>
            {it === pick && <span className="text-[10px]">← これを選ぶ</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="text-[13px] text-gray-700 leading-relaxed space-y-2 m-0 pl-5 list-decimal">{children}</ol>;
}

export function BlockedPushGuideModal({ onClose }: Props) {
  const [kind, setKind] = useState<Kind>(guessKind());

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <div>
            <p className="text-[15px] font-bold text-gray-800 m-0">通知のブロックを解除する</p>
            <p className="text-[11.5px] text-gray-400 mt-0.5">ブラウザごとに手順が異なります</p>
          </div>
          <span className="flex-1" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">

          {/* なぜアプリから直せないのか */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3">
            <p className="text-[12.5px] font-bold text-amber-900 m-0 mb-1">なぜアプリ側から直せないの？</p>
            <p className="text-[12px] text-amber-800 leading-relaxed m-0">
              通知の許可／ブロックは<b>ブラウザが端末ごとに保存している設定</b>です。
              Webサイト側から勝手に書き換えることはできません（できてしまうと、拒否したはずのサイトに
              通知を復活させられてしまうため）。<br />
              一度「ブロック」を選ぶと<b>確認ダイアログすら出なくなる</b>ので、
              下の手順でブラウザの設定を「許可」に戻してください。
            </p>
          </div>

          {/* ブラウザ切替 */}
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setKind(t.k)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border ${
                  kind === t.k
                    ? "bg-neutral-800 text-white border-neutral-800"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Chrome（PC）── */}
          {kind === "chrome" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <Steps>
                <li>アドレスバーの左端にある<b>アイコン（🔒 または ⚙ / スライダー）</b>をクリック</li>
                <li>メニューの<b>「通知」</b>を探す（表示されない場合は「サイトの設定」をクリック）</li>
                <li>プルダウンを<b className="text-red-600">「許可」</b>に変更</li>
                <li><b>ページを再読み込み</b>して、「この端末を有効にする」を押す</li>
              </Steps>
              <div className="space-y-2">
                <AddressBar highlight="🔒" />
                <PanelFigure title="このサイトの設定" items={["通知：ブロック", "通知：許可", "通知：確認する"]} pick="通知：許可" />
              </div>
            </div>
          )}

          {/* ── Edge ── */}
          {kind === "edge" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <Steps>
                <li>アドレスバー左端の<b>🔒 アイコン</b>をクリック</li>
                <li><b>「このサイトのアクセス許可」</b>を開く</li>
                <li><b>「通知」</b>を<b className="text-red-600">「許可」</b>に変更</li>
                <li>ページを再読み込みして有効化</li>
              </Steps>
              <div className="space-y-2">
                <AddressBar highlight="🔒" />
                <PanelFigure title="このサイトのアクセス許可" items={["通知：ブロック", "通知：許可"]} pick="通知：許可" />
              </div>
            </div>
          )}

          {/* ── Safari（Mac）── */}
          {kind === "safari" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <Steps>
                <li>メニューバーの<b>「Safari」＞「設定」</b>（旧：環境設定）を開く</li>
                <li><b>「Webサイト」</b>タブ ＞ 左のリストで<b>「通知」</b>を選ぶ</li>
                <li>一覧から<b className="font-mono text-[12px]">kawaicamp…</b> を探し、右のプルダウンを
                  <b className="text-red-600">「許可」</b>に変更</li>
                <li>ページを再読み込みして有効化</li>
              </Steps>
              <div className="space-y-2">
                <PanelFigure title="Safari ＞ 設定 ＞ Webサイト ＞ 通知"
                  items={["拒否", "許可"]} pick="許可" />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  ※ Mac の「システム設定 ＞ 通知」で Safari 自体の通知がオフだと、ここを許可にしても届きません。
                </p>
              </div>
            </div>
          )}

          {/* ── Firefox ── */}
          {kind === "firefox" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <Steps>
                <li>アドレスバー左端の<b>🔒 アイコン</b>をクリック</li>
                <li><b>「通知の送信」</b>の横にある<b>「ブロック中」の×</b>をクリックして解除</li>
                <li>ページを再読み込みし、再度「この端末を有効にする」を押す</li>
                <li>表示されるダイアログで<b className="text-red-600">「許可」</b>を選ぶ</li>
              </Steps>
              <div className="space-y-2">
                <AddressBar highlight="🔒" />
                <PanelFigure title="サイトの権限" items={["通知の送信：ブロック中 ✕", "（解除後）確認する"]} pick="通知の送信：ブロック中 ✕" />
              </div>
            </div>
          )}

          {/* ── Android ── */}
          {kind === "android" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <Steps>
                <li>Chrome でこのサイトを開き、アドレスバー左の<b>🔒 アイコン</b>をタップ</li>
                <li><b>「権限」＞「通知」</b>を<b className="text-red-600">「許可」</b>に変更</li>
                <li>ページを再読み込みして「この端末を有効にする」をタップ</li>
                <li>それでも届かない場合は、端末の<b>「設定」＞「アプリ」＞「Chrome」＞「通知」</b>がオンか確認</li>
              </Steps>
              <div className="space-y-2">
                <PanelFigure title="サイトの設定 ＞ 権限" items={["通知：ブロック", "通知：許可"]} pick="通知：許可" />
              </div>
            </div>
          )}

          {/* ── iPhone / iPad ── */}
          {kind === "ios" && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 220px" }}>
              <div>
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  <p className="text-[12px] text-red-800 m-0 leading-relaxed">
                    iPhone / iPad は<b>ブラウザ側では戻せません</b>。
                    ホーム画面に追加したアプリの通知設定を、<b>iOS の「設定」アプリ</b>から変更します。
                  </p>
                </div>
                <Steps>
                  <li>iPhone の<b>「設定」アプリ</b>を開く</li>
                  <li>下にスクロールして<b>「KAWAI CAMP」</b>を探してタップ<br />
                    <span className="text-[11.5px] text-gray-500">
                      （見つからない場合は「設定 ＞ 通知」の一覧からも探せます）
                    </span>
                  </li>
                  <li><b>「通知」</b>を開き、<b className="text-red-600">「通知を許可」</b>をオンにする</li>
                  <li>アプリを開き直して「この端末を有効にする」をタップ</li>
                </Steps>
                <p className="text-[11.5px] text-gray-400 mt-2.5 leading-relaxed">
                  ※ そもそも一覧に「KAWAI CAMP」が無い場合は、まだ<b>ホーム画面に追加していません</b>。
                  先に「iPhone / iPad で通知を受け取る」の手順を行ってください。
                </p>
              </div>
              <div className="space-y-2">
                <PanelFigure title="設定 ＞ KAWAI CAMP ＞ 通知"
                  items={["通知を許可：オフ", "通知を許可：オン"]} pick="通知を許可：オン" />
              </div>
            </div>
          )}

          {/* 共通の注意 */}
          <div className="border border-gray-200 rounded-xl px-3.5 py-3">
            <p className="text-[12.5px] font-bold text-gray-700 m-0 mb-2">それでも届かないとき</p>
            <ul className="text-[12px] text-gray-600 leading-relaxed space-y-1.5 m-0 pl-4 list-disc">
              <li><b className="text-gray-800">OS 側で通知がオフ</b> … ブラウザで許可しても、パソコン／スマホ本体の通知がオフだと届きません（Windows の集中モード、Mac のおやすみモード、スマホのサイレントモードなど）。</li>
              <li><b className="text-gray-800">シークレット／プライベートウィンドウ</b> … 通知の購読はできません。通常のウィンドウで開いてください。</li>
              <li><b className="text-gray-800">許可に変えたのにボタンが押せない</b> … ページの再読み込みが必要です。</li>
              <li><b className="text-gray-800">設定は端末ごと</b> … パソコンで許可しても、スマホでは別途この操作が要ります。</li>
            </ul>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2.5">
          <button onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50">
            ページを再読み込み
          </button>
          <button onClick={onClose}
            className="px-6 py-2.5 rounded-lg bg-neutral-800 text-white text-sm font-semibold hover:bg-neutral-900">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
