"use client";
// ============================================================
// iPhone / iPad の通知設定マニュアル（モーダル）
//
//   なぜこの手順が必要か：
//     iOS は「Safari で開いただけのサイト」には Web Push を許可しない。
//     ホーム画面に追加した PWA（アプリのように起動する状態）でのみ、
//     通知の購読が可能になる（iOS 16.4 以降）。
//     そのため、通知を有効化する前に必ず「ホーム画面に追加」が要る。
//
//   ⚠️ Chrome / Firefox など Safari 以外のブラウザからは「ホーム画面に追加」しても
//      通知は使えない（iOS の制約）。必ず Safari から行うこと。
//
//   図は外部画像ではなく SVG で描いている（画像ファイルの管理・差し替えを不要にするため）。
// ============================================================
import type { ReactNode } from "react";

interface Props { onClose: () => void }

/** iPhone のフレーム（中身は children） */
function Phone({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="shrink-0">
      <div className="w-[132px] h-[232px] rounded-[18px] border-[3px] border-neutral-800 bg-white overflow-hidden relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[10px] bg-neutral-800 rounded-b-[6px] z-10" />
        {children}
      </div>
      <p className="text-[10.5px] text-gray-400 text-center mt-1.5 leading-tight">{caption}</p>
    </div>
  );
}

function Step({ n, title, children, figure }: { n: number; title: string; children: ReactNode; figure: ReactNode }) {
  return (
    <div className="flex gap-4 items-start border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-6 h-6 rounded-full bg-neutral-800 text-white text-[12px] font-bold grid place-items-center shrink-0">{n}</span>
          <span className="text-[14px] font-bold text-gray-800">{title}</span>
        </div>
        <div className="text-[12.5px] text-gray-600 leading-relaxed">{children}</div>
      </div>
      {figure}
    </div>
  );
}

export function IosPushGuideModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <div>
            <p className="text-[15px] font-bold text-gray-800 m-0">iPhone / iPad で通知を受け取る</p>
            <p className="text-[11.5px] text-gray-400 mt-0.5">所要 1分・iOS 16.4 以降が必要です</p>
          </div>
          <span className="flex-1" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">

          {/* なぜ必要か */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3">
            <p className="text-[12.5px] font-bold text-amber-900 m-0 mb-1">なぜ「ホーム画面に追加」が必要？</p>
            <p className="text-[12px] text-amber-800 leading-relaxed m-0">
              iPhone / iPad では、<b>Safari で開いただけのサイトには通知を送れません</b>（iOS の仕様）。
              ホーム画面に追加して「アプリとして起動」した状態にすると、はじめて通知を受け取れるようになります。
              追加してもデータ通信量や容量はほとんど増えません（ショートカットが作られるだけです）。
            </p>
          </div>

          {/* ステップ1 */}
          <Step n={1} title="Safari でこのサイトを開く"
            figure={
              <Phone caption="Safari で開く">
                <div className="pt-4 h-full flex flex-col">
                  <div className="mx-2 mt-1 h-6 rounded-lg bg-gray-100 flex items-center px-2 gap-1">
                    <span className="text-[7px] text-gray-400">🔒 kawaicamp…</span>
                  </div>
                  <div className="flex-1 grid place-items-center">
                    <span className="text-[10px] text-gray-300">KAWAI CAMP</span>
                  </div>
                  <div className="h-8 border-t border-gray-200 flex items-center justify-around px-2">
                    <span className="text-[10px] text-gray-300">‹</span>
                    <span className="text-[10px] text-gray-300">›</span>
                    <span className="text-[12px] text-blue-500 font-bold">⬆</span>
                    <span className="text-[10px] text-gray-300">▢</span>
                    <span className="text-[10px] text-gray-300">⧉</span>
                  </div>
                </div>
              </Phone>
            }>
            <b className="text-gray-800">必ず Safari</b> で開いてください。Chrome など他のブラウザからでは通知を有効にできません。
            画面下部の<b className="text-blue-600"> 共有ボタン（□に↑）</b>をタップします。
          </Step>

          {/* ステップ2 */}
          <Step n={2} title="「ホーム画面に追加」を選ぶ"
            figure={
              <Phone caption="共有メニュー">
                <div className="pt-5 h-full bg-gray-100 flex flex-col justify-end">
                  <div className="bg-white rounded-t-2xl p-2 space-y-1.5">
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[9px] text-gray-400">
                      <span className="w-4 h-4 rounded bg-gray-200" /> ブックマークを追加
                    </div>
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[9px] text-gray-400">
                      <span className="w-4 h-4 rounded bg-gray-200" /> お気に入りに追加
                    </div>
                    <div className="flex items-center gap-2 px-1.5 py-1.5 rounded-lg bg-red-50 border border-red-300 text-[9px] font-bold text-red-600">
                      <span className="w-4 h-4 rounded bg-red-200 grid place-items-center text-[8px]">＋</span> ホーム画面に追加
                    </div>
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[9px] text-gray-400">
                      <span className="w-4 h-4 rounded bg-gray-200" /> マークアップ
                    </div>
                  </div>
                </div>
              </Phone>
            }>
            共有メニューを下にスクロールし、<b className="text-gray-800">「ホーム画面に追加」</b>をタップ。
            右上の<b className="text-gray-800">「追加」</b>を押すと、ホーム画面にアイコンができます。
          </Step>

          {/* ステップ3 */}
          <Step n={3} title="ホーム画面のアイコンから開く"
            figure={
              <Phone caption="アイコンから起動">
                <div className="pt-5 h-full bg-gradient-to-b from-sky-100 to-indigo-100 p-3">
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="h-8 rounded-[10px] bg-white/60" />
                    <div className="h-8 rounded-[10px] bg-white/60" />
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-8 h-8 rounded-[10px] bg-red-600 grid place-items-center text-white text-[8px] font-bold ring-2 ring-red-300">KC</div>
                      <span className="text-[6px] text-gray-600">KAWAI</span>
                    </div>
                  </div>
                </div>
              </Phone>
            }>
            <b className="text-red-600">ここが重要です。</b>Safari のタブからではなく、
            <b className="text-gray-800">ホーム画面に追加されたアイコン</b>からアプリを開いてください。
            Safari で開いたままでは、次の「通知を有効にする」ボタンが押せません。
          </Step>

          {/* ステップ4 */}
          <Step n={4} title="通知設定を開いて「この端末を有効にする」"
            figure={
              <Phone caption="通知を許可">
                <div className="pt-5 h-full bg-gray-50 p-2">
                  <div className="bg-white rounded-lg border border-gray-200 p-2 mb-2">
                    <div className="text-[8px] font-bold text-gray-700">この端末の通知</div>
                    <div className="mt-1.5 h-5 rounded bg-neutral-800 grid place-items-center text-[7px] text-white font-bold">
                      この端末を有効にする
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-300 p-2 shadow-sm">
                    <div className="text-[7.5px] text-gray-700 leading-tight">“KAWAI CAMP” は通知を送信します。よろしいですか？</div>
                    <div className="flex gap-1 mt-1.5">
                      <div className="flex-1 h-4 rounded bg-gray-100 grid place-items-center text-[7px] text-gray-500">許可しない</div>
                      <div className="flex-1 h-4 rounded bg-blue-500 grid place-items-center text-[7px] text-white font-bold">許可</div>
                    </div>
                  </div>
                </div>
              </Phone>
            }>
            サイドバーの<b className="text-gray-800">「通知設定」</b>を開き、
            <b className="text-gray-800">「この端末を有効にする」</b>をタップ。
            iOS が確認ダイアログを出すので<b className="text-blue-600">「許可」</b>を選びます。
            最後に<b className="text-gray-800">「テスト送信」</b>で届くか確認してください。
          </Step>

          {/* うまくいかないとき */}
          <div className="border border-gray-200 rounded-xl px-3.5 py-3">
            <p className="text-[12.5px] font-bold text-gray-700 m-0 mb-2">うまくいかないとき</p>
            <ul className="text-[12px] text-gray-600 leading-relaxed space-y-1.5 m-0 pl-4 list-disc">
              <li>
                <b className="text-gray-800">ボタンが押せない</b> … Safari のタブから開いています。
                手順3のとおり<b>ホーム画面のアイコン</b>から開き直してください。
              </li>
              <li>
                <b className="text-gray-800">一度「許可しない」を押してしまった</b> … iPhone の
                <b>「設定」アプリ ＞ 通知 ＞ KAWAI CAMP</b> から「通知を許可」をオンにしてください。
                アプリ内からは元に戻せません。
              </li>
              <li>
                <b className="text-gray-800">iOS のバージョンが古い</b> … 通知は
                <b>iOS 16.4 以降</b>が必要です。「設定 ＞ 一般 ＞ ソフトウェア・アップデート」から更新してください。
              </li>
              <li>
                <b className="text-gray-800">アイコンから開いても表示が変わらない</b> … いったんアイコンを削除し、
                Safari から追加し直すと解消することがあります（ホーム画面のアイコンを長押し → 削除）。
              </li>
            </ul>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose}
            className="px-6 py-2.5 rounded-lg bg-neutral-800 text-white text-sm font-semibold hover:bg-neutral-900">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
