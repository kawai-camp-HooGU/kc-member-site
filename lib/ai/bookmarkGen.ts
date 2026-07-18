// ============================================================
// ブックマークのAI自動生成（サーバー専用）
//   案内例原文＋ジャンル → 想定質問・検索キーワード・成型後案内例
// ============================================================
import { callClaude, parseJsonOrThrow, clampInput } from "./claude";

export interface BookmarkGen {
  expected_question: string;
  keywords: string[];
  formatted_reply: string;
}

const SYSTEM = `あなたは事務局のナレッジ整備担当です。
オペレーターが「良い案内文」と判断したトーク（案内例原文）から、AI返信提案が再利用しやすいナレッジを作ります。

入力: ジャンルと案内例原文。
出力は次のJSONのみ（前置き・コードフェンス禁止）:
{
  "expected_question": "この案内が“答え”になる、顧客からの想定質問。複数なら ' / ' 区切りで2〜4個",
  "keywords": ["検索キーワード", "..."],
  "formatted_reply": "そのまま顧客に送れる整形済みの案内文"
}

【厳守】
- keywords は3〜8個。表記ゆれ・言い換え・関連語も含める。
- formatted_reply は原文の意味を変えない。固有の数値・日程・金額は原文にあるものだけを使い、無い情報は創作しない。
- 原文に無い事実を作らない。JSON以外を出力しない。`;

export async function generateBookmarkFields(
  originalText: string, genre: string, callerMemberId: number | null,
): Promise<BookmarkGen> {
  const raw = await callClaude({
    feature: "reply_suggest",
    system: SYSTEM,
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
