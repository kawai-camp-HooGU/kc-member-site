// ============================================================
// OpenAI テキスト生成の入口（PJ側の薄い層）
//   実体は lib/ai-core/gateway/chat.ts（Ph3）。
//   lib/ai/claude.ts と同じく ./bootstrap を import して
//   Core の DB クライアント設定を済ませる。
//
//   ⚠️ テキスト生成の既定は lib/ai/claude.ts（Anthropic）である。
//      こちらは画像に付随する短文タスク専用。用途を広げないこと。
// ============================================================
import "./bootstrap";
export * from "../ai-core/gateway/chat";
