// ============================================================
// 移設済み → lib/ai-core/gateway/llm.ts（Ph3）
//   ⚠️ ここで bootstrap を import している。既存コードが lib/ai/claude.ts を
//      使っているかぎり、Core の DB クライアント設定は自動的に済む。
// ============================================================
import "./bootstrap";
export * from "../ai-core/gateway/llm";
