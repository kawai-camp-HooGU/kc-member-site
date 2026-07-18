// ============================================================
// ① メンバー AI相談チャット
//    公開中コンテンツ／お知らせ（そのメンバーが閲覧できるものだけ）と
//    事務局チャットの要約をもとに回答する。
//    料金・キャンセル・個別手続きは回答せずエスカレーションさせる。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireMember, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput, parseJsonOrThrow } from "../../../../lib/ai/claude";
import { loadPrompt } from "../../../../lib/ai/prompts";
import {
  loadAttrTree, loadMemberProfile, profileBlock, loadVisibleDocs, buildTranscript,
} from "../../../../lib/ai/context";
import type { AiCitation, AiConsultReq, AiConsultRes } from "../../../../lib/ai/types";

const DAILY_LIMIT = Number(process.env.AI_CONSULT_DAILY_LIMIT ?? 10);

interface ModelOut {
  answer?: string;
  citations?: { kind?: string; id?: number; title?: string }[];
  escalate?: boolean;
  handoffDraft?: string;
}

export async function POST(request: Request) {
  try {
    const me = await requireMember(request);
    const memberId = me.memberId as number;

    const body = (await request.json()) as AiConsultReq;
    const message = clampInput(body?.message ?? "");
    if (!message) throw new HttpError(400, "質問を入力してください");

    const remaining = await checkRateLimit(memberId, "member_consult", DAILY_LIMIT);

    // ── スレッド（無ければ作成）──
    let aiConversationId = body.aiConversationId ?? null;
    if (aiConversationId != null) {
      const { data: own } = await supabaseAdmin
        .from("ai_conversations")
        .select("id")
        .eq("id", aiConversationId)
        .eq("member_id", memberId)   // ★ 他人のスレッドを覗けないようにする
        .maybeSingle();
      if (!own) aiConversationId = null;
    }
    if (aiConversationId == null) {
      const { data: created, error } = await supabaseAdmin
        .from("ai_conversations")
        .insert({ member_id: memberId, title: message.slice(0, 40) })
        .select("id")
        .single();
      if (error || !created) throw new HttpError(500, "相談スレッドを作成できませんでした");
      aiConversationId = created.id;
    }

    // ── コンテキスト ──
    const tree = await loadAttrTree();
    const [profile, docs] = await Promise.all([
      loadMemberProfile(memberId, tree),
      loadVisibleDocs(memberId, tree),
    ]);

    // 事務局チャットの直近だけ（重複案内の防止）。全文ではなく末尾10件。
    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("id")
      .eq("member_id", memberId)
      .maybeSingle();
    const staffLog = conv ? (await buildTranscript(conv.id, 10)).text : "";

    // ── 過去のAI相談（直近20件）──
    const { data: hist } = await supabaseAdmin
      .from("ai_messages")
      .select("role, body")
      .eq("ai_conversation_id", aiConversationId)
      .order("created_at", { ascending: false })
      .limit(20);
    const history = (hist ?? []).slice().reverse();

    const contextBlock = [
      "## この方について",
      profile ? profileBlock(profile) : "（プロフィール未設定）",
      "",
      "## 参照資料（このメンバーに公開中のもののみ）",
      docs.length > 0 ? docs.map((d) => d.text).join("\n") : "（参照できる資料がありません）",
      "",
      "## 事務局チャットの直近のやり取り（重複案内を避けるため）",
      staffLog || "（やり取りはまだありません）",
    ].join("\n");

    const messages = [
      { role: "user" as const, content: contextBlock },
      { role: "assistant" as const, content: "承知しました。参照資料の範囲でお答えします。" },
      ...history.map((h) => ({
        role: (h.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: h.body ?? "",
      })),
      { role: "user" as const, content: `## 質問\n${message}` },
    ];

    const raw = await callClaude({
      feature: "member_consult",
      system: await loadPrompt("member_consult"),
      messages,
      maxTokens: 1200,
      callerMemberId: memberId,
    });
    const out = parseJsonOrThrow<ModelOut>(raw);

    // AIが返した citations を、実在する資料だけに絞る（ハルシネーション対策）
    const allowed = new Map(docs.map((d) => [`${d.citation.kind}:${d.citation.id}`, d.citation]));
    const citations: AiCitation[] = (out.citations ?? [])
      .map((c) => allowed.get(`${c.kind}:${c.id}`))
      .filter((c): c is AiCitation => Boolean(c));

    const answer = (out.answer ?? "").trim() || "うまく回答を作れませんでした。事務局にご相談ください。";
    const escalate = Boolean(out.escalate);
    const handoffDraft = (out.handoffDraft ?? "").trim();

    // ── 保存 ──
    await supabaseAdmin.from("ai_messages").insert([
      { ai_conversation_id: aiConversationId, role: "user", body: message },
      {
        ai_conversation_id: aiConversationId, role: "assistant", body: answer,
        citations: citations as unknown as never, escalate,
      },
    ]);

    const res: AiConsultRes = {
      aiConversationId, answer, citations, escalate, handoffDraft, remaining,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
