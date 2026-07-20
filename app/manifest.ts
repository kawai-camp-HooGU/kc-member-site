// ============================================================
// Web App Manifest（PWA としてインストール可能にする）
//
//   【背景】
//   これまでマニフェストが無く、Chrome の「アプリとしてインストール」で
//   作られるのは単なるショートカットだった。そのため
//     ・アプリらしいウィンドウ（アドレスバーなし）にならない
//     ・メンバー詳細を別ウィンドウで開くとブラウザのポップアップになる
//   という状態だった。
//
//   ⚠️ ブラウザのタブから「インストール済みアプリのウィンドウ」を
//      開かせる Web API は存在しない。ブラウザ側が決める領域のため、
//      アプリ側でできるのは
//        ① 正式にインストール可能にする（このファイル）
//        ② アプリ内で開く子ウィンドウをアプリウィンドウにする
//           （lib/childWindow.ts で width/height を指定してポップアップ化）
//      の2つまで。
//
//   scope を "/" にしているのは、会員ゾーン（/）と運営ゾーン（/ops）の
//   両方を同じインストール済みアプリで扱うため。
// ============================================================
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KAWAI CAMP メンバーサイト",
    short_name: "KAWAI CAMP",
    description: "オンラインコミュニティ KAWAI-CAMP の会員ポータル",
    // 着地先はロールで分かれるため "/" から入る（middleware が /ops へ振り分ける）
    start_url: "/",
    scope: "/",
    display: "standalone",
    // ブランドレッド（brand.md：ロゴの識別子）
    theme_color: "#ee1c25",
    background_color: "#f7f8fa",
    lang: "ja",
    orientation: "portrait-primary",
    icons: [
      { src: "/logo-icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
