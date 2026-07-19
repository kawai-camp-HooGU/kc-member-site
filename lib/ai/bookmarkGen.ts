// ============================================================
// ブックマークのAI自動生成（サーバー専用）
//   案内例原文＋ジャンル → 想定質問・検索キーワード・成型後案内例
//
//   ・プロンプト（役割・方針）は ai_prompts で編集可（設定 → AIプロンプト → ⑦）。
//     出力契約（JSON形式）は lib/ai/prompts.ts の OUTPUT_CONTRACT で固定。
//   ・ai_logs / レート制限は feature="bookmark_gen" で独立管理する
//     （②返信提案の枠を消費しない）。
// ============================================================
import { callClaude, checkRateLimit, parseJsonOrThrow, clampInput } from "./claude";
import { loadPrompt } from "./prompts";

export interface BookmarkGen {
  expected_question: string;
  keywords: string[];
  formatted_reply: string;
}

/** ブックマーク生成の1日上限（未設定なら運営枠 → 200） */
const DAILY_LIMIT = Number(
  process.env.AI_BOOKMARK_DAILY_LIMIT ?? process.env.AI_OPS_DAILY_LIMIT ?? 200,
);

export async function generateBookmarkFields(
  originalText: string, genre: string, callerMemberId: number | null,
): Promise<BookmarkGen> {
  // 上限超過は 429。登録APIは catch して ai_pending=true で保存する（登録自体は止めない）。
  await checkRateLimit(callerMemberId, "bookmark_gen", DAILY_LIMIT);

  const raw = await callClaude({
    feature: "bookmark_gen",
    system: await loadPrompt("bookmark_gen"),
    messages: [{ role: "user", content: `ジャンル: ${genre}\n\n案内例原文:\n${clampInput(originalText, 4000)}` }],
    maxTokens: 900,
    temperature: 0.4,
    callerMemberId,
  });
  const out = parseJsonOrThrow<{ expected_question?: string; keywords?: string[]; formatted_reply?: string }>(raw);
  return {
    expected_question: (out.expected_question ?? "").trim(),
    keywords: (out.keywords ?? [])
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim()).filter(Boolean).slice(0, 8),
    formatted_reply: (out.formatted_reply ?? "").trim(),
  };
}
