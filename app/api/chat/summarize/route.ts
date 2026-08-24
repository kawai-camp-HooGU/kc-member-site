// ============================================================
// 会話要約（運営）
//   顧客とのチャット履歴を時系列で要約する。
//
//   ⚠️ 2026-08-23（R2）：独自の fetch をやめ、callClaude() へ集約した。
//      これにより ai_logs / ai_traces・レート制限・timeout / retry が効く。
//      プロンプトは ai_prompts.summarize（設定 → AIプロンプト → ⑨）で編集できる。
//   ⚠️ 履歴に上限を入れた。以前は limit なしの全件投入で、
//      長期顧客ほど context window 超過とコスト増のリスクがあった。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, LIGHT_MODEL } from "../../../../lib/ai/claude";
import { loadPromptBundle } from "../../../../lib/ai/prompts";
import { wrap } from "../../../../lib/ai/context";
import { maskText } from "../../../../lib/ai/pii";

interface Body { conversationId?: number }

/** 要約に渡す履歴の上限（件数・文字数の両方で頭打ちにする） */
const MAX_MESSAGES = 200;
const MAX_CHARS = 20_000;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    // ── 権限チェック：スタッフ（管理者/オペレーター）のみ ──
    const me = await requireOps(request);

    const { conversationId } = (await request.json()) as Body;
    if (conversationId == null) {
      throw new HttpError(400, "conversationId は必須です");
    }

    await checkRateLimit(me.memberId, "summarize", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    // ── メッセージを新しい順に取り、上限内で古い順へ戻す ──
    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_side, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES);
    if (msgErr) throw new HttpError(500, msgErr.message);
    if (!msgs || msgs.length === 0) {
      return NextResponse.json({ summary: "まだやり取りがありません。" });
    }

    const lines = msgs.slice().reverse().map((m) => {
      const who = m.sender_side === "staff" ? "事務局" : "顧客";
      const ts = (m.created_at ?? "").replace("T", " ").slice(0, 16);
      // 個人情報（メール・電話）は伏せてから渡す
      const body = maskText((m.body ?? "").trim()) || "（添付ファイル）";
      return `[${ts}] ${who}: ${body}`;
    });

    let transcript = lines.join("\n");
    let truncated = msgs.length >= MAX_MESSAGES;
    if (transcript.length > MAX_CHARS) {
      transcript = transcript.slice(-MAX_CHARS);
      truncated = true;
    }
    if (truncated) transcript = `（これ以前のやり取りは省略）\n${transcript}`;

    const p = await loadPromptBundle("summarize");
    const summary = await callClaude({
      feature: "summarize",
      system: p.system,
      messages: [{ role: "user", content: wrap("history", transcript) }],
      maxTokens: 1024,
      temperature: p.temperature ?? 0.3,
      model: p.model ?? LIGHT_MODEL,
      promptVersion: p.version,
      callerMemberId: me.memberId,
      userInput: `conversation:${conversationId}`,
      startedAt: started,
    });

    return NextResponse.json({ summary: summary || "要約を生成できませんでした。" });
  } catch (err) {
    return errorResponse(err);
  }
}
