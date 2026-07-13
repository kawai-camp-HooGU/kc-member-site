import type { MetadataRoute } from "next";

// ============================================================
// robots.txt（Phase 2）
//
//   ログイン必須のポータル本体・運営コンソールはインデックス不要。
//   公開フォーム /f/[slug] と コンテンツ公開URL /c/[token] だけは許可する。
//
//   ⚠️ /c/[token] のうち「外部公開OFF」のものは、ページ側の generateMetadata が
//      noindex を返す（robots.txt の allow はクロール可否であって index 可否ではない）。
//
//   ⚠️ robots.txt は「お願い」にすぎない（従わないクローラーもいる）。
//      本命は middleware が付ける `X-Robots-Tag: noindex, nofollow` ヘッダ。
// ============================================================
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/f/", "/c/"],
        disallow: ["/", "/ops", "/ops/", "/login", "/set-password", "/api/"],
      },
    ],
  };
}
