// ============================================================
// ③ メッセージ添削（送信前の最後の関門）
//    誤字・敬語 / リスク表現（断定・約束・個人情報）/ トーン / 簡潔さ
//    文意を変えず、事実を追加しないことを厳命する。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import {
  callClaude, checkRateLimit, clampInput, parseJsonOrThrow, LIGHT_MODEL,
} from "../../../../lib/ai/claude";
import { loadPrompt } from "../../../../lib/ai/prompts";
import {
  loadAttrTree, loadMemberProfile, profileBlock, buildTranscript,
  memberIdOfConversation, loadStyleGuide,
} from "../../../../lib/ai/context";
import { REVIEW_ASPECTS } from "../../../../lib/ai/types";
import type {
  ReviewAspect, ReviewIssue, ReviewReq, ReviewRes, ReviewSeverity,
} from "../../../../lib/ai/types";

interface ModelIssue {
  severity?: string; category?: string; quote?: string; reason?: string; fix?: string;
}
interface ModelOut { issues?: ModelIssue[]; revised?: string }

const SEV = (v: string | undefined): ReviewSeverity =>
  v === "critical" || v === "warning" || v === "suggest" ? v : "suggest";

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = (await request.json()) as ReviewReq;

    const draft = clampInput(body?.draft ?? "");
    if (!draft) throw new HttpError(400, "添削する文面を入力してください");

    await checkRateLimit(me.memberId, "review", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const aspects: ReviewAspect[] =
      body.aspects && body.aspects.length > 0 ? body.aspects : ["typo", "risk", "tone"];
    const aspectLabels = REVIEW_ASPECTS.filter((a) => aspects.includes(a.key)).map((a) => a.label);

    // 相手のトーン把握用（要約のみ・全文は不要）
    let customerBlock = "（送信相手の情報なし）";
    if (body.conversationId != null) {
      const customerId = await memberIdOfConversation(body.conversationId);
      if (customerId != null) {
        const tree = await loadAttrTree();
        const [profile, transcript] = await Promise.all([
          loadMemberProfile(customerId, tree),
          buildTranscript(body.conversationId, 6),
        ]);
        customerBlock = [
          profile ? profileBlock(profile) : "",
          transcript.text ? `\n直近のやり取り:\n${transcript.text}` : "",
        ].filter(Boolean).join("\n");
      }
    }

    const styleGuide = await loadStyleGuide();

    const user = [
      "## 送信相手",
      customerBlock,
      styleGuide ? `\n## 事務局の文体ガイド\n${styleGuide}` : "",
      `\n## チェック観点\n${aspectLabels.join(" / ")}`,
      "\n## 添削対象（オペレーターの下書き）",
      "<draft>",
      draft,
      "</draft>",
    ].join("\n");

    const raw = await callClaude({
      feature: "review",
      system: await loadPrompt("review"),
      messages: [{ role: "user", content: user }],
      maxTokens: 1500,
      temperature: 0.2,
      model: LIGHT_MODEL,
      callerMemberId: me.memberId,
    });
    const out = parseJsonOrThrow<ModelOut>(raw);

    const issues: ReviewIssue[] = (out.issues ?? [])
      .filter((i) => (i.reason ?? "").trim())
      .slice(0, 12)
      .map((i) => ({
        severity: SEV(i.severity),
        category: (i.category ?? "その他").trim(),
        quote: (i.quote ?? "").trim(),
        reason: (i.reason ?? "").trim(),
        fix: (i.fix ?? "").trim(),
      }));

    const revised = (out.revised ?? "").trim() || draft;

    const res: ReviewRes = {
      issues,
      revised,
      stats: { before: draft.length, after: revised.length },
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
