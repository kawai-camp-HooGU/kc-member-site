// ============================================================
// 画像生成の入口（PJ側の薄い層）
//   実体は lib/ai-core/gateway/image.ts（Ph3）。
//   lib/ai/claude.ts と同じく ./bootstrap を import して
//   Core の DB クライアント設定を済ませる。
// ============================================================
import "./bootstrap";
export * from "../ai-core/gateway/image";
