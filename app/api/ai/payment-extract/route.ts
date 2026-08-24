// ============================================================
// 決済スクショ → 決済情報の下書き抽出（vision）
//
//   POST /api/ai/payment-extract  { imageBase64, mediaType }  →  { data: PaymentExtract }
//
//   ・運営のみ（requireOps）。レート制限は ai_usage カウンタ（既存 checkRateLimit）。
//   ・抽出は「下書き」で、確定は人が行う。
//
//   ⚠️ 2026-08-23（R2）：Anthropic API の直叩きをやめ、callClaude() へ集約した。
//      callClaude がマルチモーダル（画像ブロック）に対応したため。
//      これで timeout / retry / ai_traces が効く。
//      プロンプトは ai_prompts.payment_extract（設定 → AIプロンプト → ⑩）で編集できる。
//   ⚠️ 画像の base64 はトレースに保存しない（maskForTrace が落とす）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, parseJsonOrThrow } from "../../../../lib/ai/claude";
import { loadPromptBundle } from "../../../../lib/ai/prompts";
import type { PaymentExtract } from "../../../../lib/models";

const DAILY_LIMIT = Number(process.env.AI_PAYMENT_DAILY_LIMIT ?? 50);

/** 受け入れる画像の上限（base64 の文字数で概算。約5MB） */
const MAX_IMAGE_CHARS = 7_000_000;

interface ModelOut {
  paidAt?: string; typeName?: string; siteName?: string; methodName?: string;
  amount?: number | string; recognizedAmount?: number | string; currency?: string;
  customerName?: string; customerKana?: string; customerEmail?: string; customerTel?: string;
  lowConfidence?: string[];
}

const toInt = (v: number | string | undefined): number | undefined => {
  if (v == null) return undefined;
  const n = typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : v;
  return Number.isFinite(n) ? n : undefined;
};

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const me = await requireOps(request);
    await checkRateLimit(me.memberId, "payment_extract", DAILY_LIMIT);

    const { imageBase64, mediaType } = (await request.json()) as {
      imageBase64?: string; mediaType?: string;
    };
    if (!imageBase64) throw new HttpError(400, "画像がありません");
    if (imageBase64.length > MAX_IMAGE_CHARS) {
      throw new HttpError(400, "画像が大きすぎます（約5MBまで）。縮小してからお試しください。");
    }

    const p = await loadPromptBundle("payment_extract");
    const text = await callClaude({
      feature: "payment_extract",
      system: p.system,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
          { type: "text", text: "この決済画面から決済情報を読み取り、指定の JSON のみで返してください。" },
        ],
      }],
      maxTokens: 512,
      temperature: p.temperature ?? 0,
      model: p.model ?? undefined,
      promptVersion: p.version,
      callerMemberId: me.memberId,
      userInput: "（決済スクリーンショット）",
      startedAt: started,
    });

    const out = parseJsonOrThrow<ModelOut>(text);
    const data: PaymentExtract = {
      paidAt: out.paidAt,
      typeName: out.typeName,
      siteName: out.siteName,
      methodName: out.methodName,
      amount: toInt(out.amount),
      recognizedAmount: toInt(out.recognizedAmount),
      currency: out.currency || "JPY",
      customerName: out.customerName,
      customerKana: out.customerKana,
      customerEmail: out.customerEmail,
      customerTel: out.customerTel,
      lowConfidence: Array.isArray(out.lowConfidence) ? out.lowConfidence : [],
    };

    return NextResponse.json({ data });
  } catch (e) {
    return errorResponse(e);
  }
}
