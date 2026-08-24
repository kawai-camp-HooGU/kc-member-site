// ============================================================
// LINEトーク向け AI返信提案（Phase 3）
//    action="generate" … 「提案メッセージを生成」→ 最大3案
//    action="chat"     … 壁打ち（相談入力）→ talk ＋ 改訂案
//
//    ★ AIは送信APIを一切呼ばない。出口はクライアントの入力欄のみ。
//    既存 reply-suggest と同じプロンプト・ナレッジ（ブックマークは channel 横断で共通）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import {
  callClaude, checkRateLimit, clampInput, parseJsonOrThrow, extractNeedsInput,
} from "../../../../lib/ai/claude";
import { loadPromptBundle } from "../../../../lib/ai/prompts";
import {
  loadAttrTree, loadMemberProfile, profileBlock,
  buildLineTranscript, lastLineInbound, memberIdOfFriend,
  loadKnowledge, loadStyleGuide, loadBookmarkKnowledgeFor, wrap,
} from "../../../../lib/ai/context";
import {
  loadConsultHistory, appendConsultTurns, resetConsultSession,
} from "../../../../lib/ai/consultSession";
import type { AiDraft, AiTone, AiLength, ReplySuggestRes } from "../../../../lib/ai/types";

interface Body {
  friendId?: number;
  action?: "generate" | "chat" | "reset";
  tone?: AiTone;
  length?: AiLength;
  count?: number;
  message?: string;
  /** @deprecated A-3 で廃止。サーバーは読まない。 */
  history?: { role?: string; content?: string }[];
}
interface ModelDraft { label?: string; tone?: string; text?: string; basis?: string[] }
interface ModelOut { talk?: string; drafts?: ModelDraft[] }

const TONE_LABEL: Record<AiTone, string> = {
  standard: "標準（丁寧だが硬すぎない）", polite: "丁寧・フォーマル", casual: "カジュアル・親しみやすい",
};
const LENGTH_LABEL: Record<AiLength, string> = {
  standard: "標準（150〜250字）", short: "短く（100字以内）", long: "詳しく（300字以上）",
};

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  try {
    const me = await requireOps(request);
    const body = (await request.json()) as Body;
    const friendId = body.friendId;
    if (friendId == null) throw new HttpError(400, "friendId は必須です");

    // 相談ログのやり直し（画面の「リセット」）。LLMは呼ばない。
    if (body.action === "reset") {
      await resetConsultSession(me.memberId, "line", friendId);
      return NextResponse.json({ talk: "", drafts: [], usedContext: { messages: 0, knowledge: 0 } });
    }

    await checkRateLimit(me.memberId, "reply_suggest", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const memberId = await memberIdOfFriend(friendId);
    const tree = await loadAttrTree();
    // ブックマークの関連検索は「顧客の直前メッセージ」をクエリにするため先に取得
    const lastMsg = await lastLineInbound(friendId);
    const [profile, transcript, kb, bm, styleGuide] = await Promise.all([
      memberId != null ? loadMemberProfile(memberId, tree) : Promise.resolve(null),
      buildLineTranscript(friendId),
      loadKnowledge(),
      loadBookmarkKnowledgeFor(lastMsg),
      loadStyleGuide(),
    ]);

    const tone = body.tone ?? "standard";
    const length = body.length ?? "standard";
    const count = Math.min(3, Math.max(1, body.count ?? 3));

    // ★ 顧客の発言・ナレッジ本文はタグで囲む（間接プロンプトインジェクション対策）
    const contextBlock = [
      wrap("profile", profile ? profileBlock(profile) : "（会員未連携。LINEの表示名・トーク内容のみ）"),
      wrap("history", transcript.text || "（やり取りはまだありません）"),
      wrap("question", lastMsg || "（なし）"),
      "※ <history> はLINEトーク。<question> は直前の未返信メッセージ。",
      wrap("knowledge",
        [
          "【ブックマークナレッジ（最優先で参照）】",
          bm.text || "（登録なし）",
          "",
          "【社内ナレッジ】",
          kb.text || "（登録なし）",
        ].join("\n")),
      styleGuide ? `\n## 事務局の文体ガイド\n${styleGuide}` : "",
    ].join("\n\n");

    // ★ A-3：相談履歴はサーバーから読む。リクエストの body.history は一切見ない。
    const { sessionId, turns: history } = await loadConsultHistory(me.memberId, "line", friendId);

    if (body.action === "chat" && !(body.message ?? "").trim()) {
      throw new HttpError(400, "相談内容を入力してください");
    }

    const instruction =
      body.action === "chat"
        ? `## 追加の指示（オペレーターから）\n${clampInput(body.message ?? "")}\n\n改訂した案を drafts に入れて返してください（案は1つでよい）。`
        : `## 依頼\n直前の未返信メッセージへのLINE返信案を ${count} 案つくってください。\n` +
          `方針は「謝罪＋即対応」「簡潔・スピード」「先回り確認」のように変えること。\n` +
          `LINEなので、長すぎない・親しみやすい文体を意識。トーン: ${TONE_LABEL[tone]}\n長さ: ${LENGTH_LABEL[length]}`;

    const messages = [
      { role: "user" as const, content: contextBlock },
      { role: "assistant" as const, content: "承知しました。この顧客の情報と履歴を把握しました。" },
      ...history,
      { role: "user" as const, content: instruction },
    ];

    const p = await loadPromptBundle("reply_suggest");
    const raw = await callClaude({
      feature: "reply_suggest",
      system: p.system,
      messages,
      maxTokens: 2000,
      model: p.model ?? undefined,
      temperature: p.temperature ?? 0.6,
      promptVersion: p.version,
      callerMemberId: me.memberId,
      userInput: lastMsg,
      startedAt: started,
    });
    const out = parseJsonOrThrow<ModelOut>(raw);

    const labels = ["案 A", "案 B", "案 C"];
    const drafts: AiDraft[] = (out.drafts ?? [])
      .filter((d) => (d.text ?? "").trim())
      .slice(0, 3)
      .map((d, i) => {
        const text = (d.text ?? "").trim();
        return {
          label: (d.label ?? "").trim() || labels[i] || `案 ${i + 1}`,
          tone: (d.tone ?? "").trim() || "標準",
          text,
          basis: (d.basis ?? []).filter((x) => typeof x === "string").slice(0, 4),
          needsInput: extractNeedsInput(text),
        };
      });

    if (drafts.length === 0) throw new HttpError(502, "返信案を生成できませんでした。もう一度お試しください。");

    const talk = (out.talk ?? "").trim();

    await appendConsultTurns(sessionId, [
      ...(body.action === "chat" && (body.message ?? "").trim()
        ? [{ role: "user" as const, content: (body.message ?? "").trim() }] : []),
      ...(talk ? [{ role: "assistant" as const, content: talk }] : []),
    ]);

    const res: ReplySuggestRes = {
      talk,
      drafts,
      usedContext: { messages: transcript.count, knowledge: kb.count + bm.count },
      sessionId,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
