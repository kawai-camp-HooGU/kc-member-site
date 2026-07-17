// ============================================================
// 決済スクショ → 決済情報の下書き抽出（vision）
//
//   POST /api/ai/payment-extract  { imageBase64, mediaType }  →  { data: PaymentExtract }
//
//   ・運営のみ（requireOps）。レート制限は ai_logs ベース（既存 checkRateLimit）。
//   ・画像入力を使うため callClaude（テキスト専用）ではなく Anthropic API を直接呼ぶ。
//   ・出力は JSON のみ（前置き・コードフェンス禁止）。抽出は「下書き」で確定は人が行う。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { checkRateLimit, parseJsonOrThrow } from "../../../../lib/ai/claude";
import type { PaymentExtract } from "../../../../lib/models";

const DAILY_LIMIT = Number(process.env.AI_PAYMENT_DAILY_LIMIT ?? 50);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const SYSTEM = `あなたは決済管理のアシスタントです。決済サイトのスクリーンショット画像から、決済情報を読み取ります。

【厳守】
- 画像に明記されている情報だけを読み取る。推測で埋めない（読めない項目は省略）。
- 金額は数値のみ（円。カンマ・通貨記号・小数を除く整数）。
- amount は「決済金額（顧客が支払った総額）」。recognizedAmount は「決済手数料を差し引いた対象金額（純額）」が読み取れる場合のみ返す。
- 商品種別(typeName)・決済サイト(siteName)・決済方法(methodName)は、画像に出ている名称をそのまま返す（IDや番号ではない）。
- 日時は "YYYY-MM-DDTHH:mm" 形式。時刻が不明なら日付だけ（"YYYY-MM-DD"）。
- 読み取りに自信が持てない項目は lowConfidence 配列に項目名を入れる。

【出力】必ず次の JSON のみを返す（前置き・コードフェンス禁止）:
{
  "paidAt": "2026-07-14T15:18",
  "typeName": "本講座（一括）",
  "siteName": "Stripe",
  "methodName": "クレジットカード",
  "amount": 55000,
  "recognizedAmount": 50000,
  "currency": "JPY",
  "customerName": "田中 太郎",
  "customerKana": "タナカ タロウ",
  "customerEmail": "tanaka@example.com",
  "customerTel": "090-1234-5678",
  "lowConfidence": ["customerName"]
}
読み取れない項目はキーごと省略してよい。`;

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

    const { imageBase64, mediaType } = (await request.json()) as { imageBase64?: string; mediaType?: string };
    if (!imageBase64) return NextResponse.json({ error: "画像がありません" }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new HttpError(500, "ANTHROPIC_API_KEY がサーバーに設定されていません");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
            { type: "text", text: "この決済画面から決済情報を読み取り、指定の JSON のみで返してください。" },
          ],
        }],
      }),
    });

    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new HttpError(502, json?.error?.message ?? `AI呼び出しに失敗しました (${res.status})`);
    }

    const text = (json.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string).join("\n").trim();

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

    await supabaseAdmin.from("ai_logs").insert({
      feature: "payment_extract", member_id: me.memberId, model: MODEL,
      tokens_in: json.usage?.input_tokens ?? 0, tokens_out: json.usage?.output_tokens ?? 0,
      latency_ms: Date.now() - started, ok: true,
    }).then(({ error }) => { if (error) console.warn("ai_logs 記録失敗:", error.message); });

    return NextResponse.json({ data });
  } catch (e) {
    return errorResponse(e);
  }
}
