import type { MetadataRoute } from "next";

// ============================================================
// robots.txt（Phase 2）
//
//   ログイン必須のポータル本体・運営コンソールはインデックス不要。
//   公開フォーム /f/[slug] だけは集客に使うので許可する。
//
//   ⚠️ robots.txt は「お願い」にすぎない（従わないクローラーもいる）。
//      本命は middleware が付ける `X-Robots-Tag: noindex, nofollow` ヘッダ。
// ============================================================
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/f/"],
        disallow: ["/", "/ops", "/ops/", "/login", "/set-password", "/api/"],
      },
    ],
  };
}
