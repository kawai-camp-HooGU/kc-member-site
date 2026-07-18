// ============================================================
// プロンプト管理（管理者のみ）
//   GET  … 全機能の役割・方針（DB or 既定）＋固定の出力契約を返す
//   PUT  … 1機能の役割・方針を保存（ai_prompts upsert ＋ 変更履歴）
//   POST … プレビュー：保存せず、編集中の本文で1回だけ試走して出力を返す
//
//   ★ 編集できるのは「役割・方針」だけ。出力契約はコード側で固定。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, clampInput } from "../../../../lib/ai/claude";
import {
  PROMPT_FEATURES, DEFAULT_PROMPTS, contractPreview,
} from "../../../../lib/ai/prompts";
import type {
  AiFeature, AiPromptItem, AiPromptSaveReq, AiPromptPreviewReq, AiPromptPreviewRes,
} from "../../../../lib/ai/types";

const FEATURE_KEYS = PROMPT_FEATURES.map((p) => p.feature);
const isFeature = (v: unknown): v is AiFeature =>
  typeof v === "string" && (FEATURE_KEYS as string[]).includes(v);

interface Row {
  feature: string;
  body: string | null;
  model: string | null;
  temperature: number | null;
  enabled: boolean | null;
  updated_at: string | null;
}

// ── GET：一覧 ──────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const { data } = await sb.from("ai_prompts").select("feature, body, model, temperature, enabled, updated_at");
    const rows = (data as Row[] | null) ?? [];
    const byFeature = new Map(rows.map((r) => [r.feature, r]));

    const items: AiPromptItem[] = PROMPT_FEATURES.map(({ feature, label }) => {
      const r = byFeature.get(feature);
      const saved = Boolean(r && (r.body ?? "").trim());
      return {
        feature,
        label,
        body: saved ? (r!.body ?? "") : (DEFAULT_PROMPTS[feature] ?? ""),
        defaultBody: DEFAULT_PROMPTS[feature] ?? "",
        contract: contractPreview(feature),
        saved,
        model: r?.model ?? null,
        temperature: r?.temperature ?? null,
        updatedAt: r?.updated_at ?? null,
      };
    });
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

// ── PUT：保存 ──────────────────────────────────────────────────
export async function PUT(request: Request) {
  try {
    const me = await requireAdmin(request);
    const body = (await request.json()) as AiPromptSaveReq;
    if (!isFeature(body?.feature)) throw new HttpError(400, "featureが不正です");

    const text = (body.body ?? "").trim();
    if (!text) throw new HttpError(400, "役割・方針を入力してください（空にはできません）");

    const label = PROMPT_FEATURES.find((p) => p.feature === body.feature)?.label ?? "";
    const sb = supabaseAdmin as unknown as SupabaseClient;

    const { error } = await sb.from("ai_prompts").upsert({
      feature: body.feature,
      label,
      body: text,
      model: body.model ?? null,
      temperature: body.temperature ?? null,
      enabled: true,
      updated_by: me.memberId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "feature" });
    if (error) throw new HttpError(500, "保存に失敗しました");

    // 変更履歴（失敗しても保存自体は成功扱い）
    await sb.from("ai_prompt_revisions").insert({
      feature: body.feature, body: text, edited_by: me.memberId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

// ── POST：プレビュー（保存しない）──────────────────────────────
export async function POST(request: Request) {
  try {
    const me = await requireAdmin(request);
    const body = (await request.json()) as AiPromptPreviewReq;
    if (!isFeature(body?.feature)) throw new HttpError(400, "featureが不正です");

    const role = (body.body ?? "").trim();
    if (!role) throw new HttpError(400, "役割・方針を入力してください");

    // 編集中の役割 ＋ 固定の出力契約 で system を組む（保存はしない）
    const system = role + contractPreview(body.feature);
    const sample = clampInput(body.sample ?? "", 2000) || "（サンプル入力なし）テスト用に短い例を1つ生成してください。";

    const preview = await callClaude({
      feature: body.feature,
      system,
      messages: [{ role: "user", content: sample }],
      maxTokens: 1200,
      temperature: 0.4,
      callerMemberId: me.memberId,
    });

    const res: AiPromptPreviewRes = { preview };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
