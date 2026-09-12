// ============================================================
// 移設済み → lib/ai-core/guardrails/sanitize.ts（Ph3）
//
//   ここは PJ 側の入口。AI Core の汎用エンジンを再輸出しつつ、
//   **KAWAI CAMP 固有のプロファイル**だけをこの層に置く。
//   AI Core にPJ固有の概念（contents.public_token 等）を持ち込まないため。
// ============================================================
export * from "../ai-core/guardrails/sanitize";

import {
  ALLOWED_TAGS,
  BODY_PROFILE,
  type SanitizeProfile,
} from "../ai-core/guardrails/sanitize";

/**
 * 本文HTMLの埋め込みトークン `data-embed` に許可する値（REQ-106）。
 *
 *   値は contents.public_token（/c/{token} と同じもの）。
 *   ⚠️ lib/contentsServer.ts の公開URLトークン検査と**同じ形**にすること。
 *      別定義にすると、長いトークンが保存時に無言で落ちて原因が分からなくなる。
 */
export const EMBED_TOKEN_RE = /^[0-9a-f]{8,64}$/i;

/**
 * コンテンツ本文（contents.body_html）用プロファイル。
 *
 *   従来の BODY_PROFILE に「div の data-embed」だけを足したもの。
 *   video / iframe / script は**引き続き禁止のまま**で、
 *   サニタイザの防御範囲は広げない（プレーヤーは React 部品として描く）。
 *
 *   ⚠️ div キーを新設したことで、この tag では "*" のフォールバックが
 *      効かなくなる（sanitize.ts の allowedAttrs[tag] ?? allowedAttrs["*"]）。
 *      将来 "*" に属性を足すときは div にも足すこと。
 */
export const BODY_EMBED_PROFILE: SanitizeProfile = {
  allowedTags: ALLOWED_TAGS,
  allowedAttrs: {
    ...BODY_PROFILE.allowedAttrs,
    div: new Set(["data-embed", "class", "style"]),
  },
  validateAttr: (tag, name, value) =>
    name !== "data-embed" ? true : (tag === "div" && EMBED_TOKEN_RE.test(value)),
};
