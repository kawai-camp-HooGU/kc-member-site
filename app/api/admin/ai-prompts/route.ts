// ============================================================
// プロンプト管理（管理者のみ）
//   GET  … 全機能の役割・方針（DB or 既定）＋固定の出力契約 ＋ 共通パーツを返す
//   PUT  … 1機能の役割・方針、または1パーツを保存（upsert ＋ 変更履歴）
//   POST … プレビュー：保存せず、編集中の本文で1回だけ試走して出力を返す
//
//   ★ 編集できるのは「役割・方針」と「共通パーツ」だけ。出力契約はコード側で固定。
//   ★ パーツは {{part:key}} で本文へ差し込まれる。1つのパーツが複数機能に効くため、
//     GET は usedBy（参照している機能）を返す。影響範囲が見えないまま編集させない。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, clampInput } from "../../../../lib/ai/claude";
import {
  PROMPT_FEATURES, DEFAULT_PROMPTS, contractPreview,
  PROMPT_PARTS, DEFAULT_PARTS, refPartsOf, buildPreviewSystem,
} from "../../../../lib/ai/prompts";
import { asView } from "../../../../lib/ai/types";
import type {
  AiFeature, AiPromptItem, AiPromptPartItem,
  AiPromptSaveReq, AiPromptPreviewReq, AiPromptPreviewRes,
} from "../../../../lib/ai/types";

const FEATURE_KEYS = PROMPT_FEATURES.map((p) => p.feature);
const isFeature = (v: unknown): v is AiFeature =>
  typeof v === "string" && (FEATURE_KEYS as string[]).includes(v);

const PART_KEYS = PROMPT_PARTS.map((p) => p.key);
const isPartKey = (v: unknown): v is string =>
  typeof v === "string" && PART_KEYS.includes(v);

interface Row {
  feature: string;
  body: string | null;
  model: string | null;
  temperature: number | null;
  enabled: boolean | null;
  updated_at: string | null;
}
interface PartRow {
  key: string;
  body: string | null;
  enabled: boolean | null;
  updated_at: string | null;
}

/** 本文の {{part:view}} は view_support / view_holder の両方を指す */
function expandRefs(refs: string[]): string[] {
  const out = new Set<string>();
  for (const r of refs) {
    if (r === "view") { out.add("view_support"); out.add("view_holder"); }
    else out.add(r);
  }
  return Array.from(out);
}

// ── GET：一覧 ──────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const sb = supabaseAdmin as unknown as SupabaseClient;

    const [{ data: pData }, { data: partData }] = await Promise.all([
      sb.from("ai_prompts").select("feature, body, model, temperature, enabled, updated_at"),
      sb.from("ai_prompt_parts").select("key, body, enabled, updated_at"),
    ]);
    const rows = (pData as Row[] | null) ?? [];
    const byFeature = new Map(rows.map((r) => [r.feature, r]));

    const items: AiPromptItem[] = PROMPT_FEATURES.map(({ feature, label }) => {
      const r = byFeature.get(feature);
      const saved = Boolean(r && (r.body ?? "").trim());
      const body = saved ? (r!.body ?? "") : (DEFAULT_PROMPTS[feature] ?? "");
      return {
        feature,
        label,
        body,
        defaultBody: DEFAULT_PROMPTS[feature] ?? "",
        contract: contractPreview(feature),
        saved,
        model: r?.model ?? null,
        temperature: r?.temperature ?? null,
        updatedAt: r?.updated_at ?? null,
        refParts: refPartsOf(body),
      };
    });

    // どのパーツがどの機能から参照されているか（＝編集の影響範囲）
    const usedBy = new Map<string, string[]>();
    for (const it of items) {
      for (const k of expandRefs(it.refParts)) {
        usedBy.set(k, [...(usedBy.get(k) ?? []), it.label]);
      }
    }

    const partRows = (partData as PartRow[] | null) ?? [];
    const byKey = new Map(partRows.map((r) => [r.key, r]));

    const parts: AiPromptPartItem[] = PROMPT_PARTS.map(({ key, label, kind }) => {
      const r = byKey.get(key);
      const saved = Boolean(r && (r.body ?? "").trim());
      return {
        key,
        label,
        kind,
        body: saved ? (r!.body ?? "") : (DEFAULT_PARTS[key] ?? ""),
        defaultBody: DEFAULT_PARTS[key] ?? "",
        saved,
        usedBy: usedBy.get(key) ?? [],
        updatedAt: r?.updated_at ?? null,
      };
    });

    return NextResponse.json({ items, parts });
  } catch (err) {
    return errorResponse(err);
  }
}

// ── PUT：保存 ──────────────────────────────────────────────────
export async function PUT(request: Request) {
  try {
    const me = await requireAdmin(request);
    const body = (await request.json()) as AiPromptSaveReq;
    const sb = supabaseAdmin as unknown as SupabaseClient;

    const text = (body.body ?? "").trim();
    if (!text) throw new HttpError(400, "本文を入力してください（空にはできません）");

    // ── 共通パーツの保存 ──
    if (body.kind === "part") {
      if (!isPartKey(body.key)) throw new HttpError(400, "パーツのキーが不正です");
      const def = PROMPT_PARTS.find((p) => p.key === body.key)!;

      const { error } = await sb.from("ai_prompt_parts").upsert({
        key: def.key,
        label: def.label,
        kind: def.kind,
        body: text,
        enabled: true,
        updated_by: me.memberId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) throw new HttpError(500, "保存に失敗しました");

      await sb.from("ai_prompt_part_revisions").insert({
        key: def.key, body: text, edited_by: me.memberId,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 機能の役割・方針の保存 ──
    if (!isFeature(body?.feature)) throw new HttpError(400, "featureが不正です");

    // 未定義のパーツキーは保存時に気づかせる（実行時は空文字で素通りするため）
    const unknown = refPartsOf(text)
      .map((k) => (k === "view" ? "view_support" : k))
      .filter((k) => !PART_KEYS.includes(k));
    if (unknown.length > 0) {
      throw new HttpError(400, `存在しないパーツを参照しています: ${unknown.join(" / ")}`);
    }

    const label = PROMPT_FEATURES.find((p) => p.feature === body.feature)?.label ?? "";

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

    const text = (body.body ?? "").trim();
    if (!text) throw new HttpError(400, "本文を入力してください");
    const view = asView(body.view);

    // 対象の機能と、パーツの上書きを決める
    let feature: AiFeature;
    let role: string;
    let overrides: Record<string, string> | undefined;

    if (body.kind === "part") {
      if (!isPartKey(body.key)) throw new HttpError(400, "パーツのキーが不正です");
      // パーツ単体では試走できない。参照している機能に差し込んで確認する。
      feature = pickFeatureFor(body.key, view);
      role = DEFAULT_PROMPTS[feature] ?? "";
      overrides = { [body.key]: text };
    } else {
      if (!isFeature(body?.feature)) throw new HttpError(400, "featureが不正です");
      feature = body.feature;
      role = text;
    }

    const built = await buildPreviewSystem(feature, role, view, overrides);
    const sample = clampInput(body.sample ?? "", 2000)
      || "（サンプル入力なし）テスト用に短い例を1つ生成してください。";

    const preview = await callClaude({
      feature,
      system: built.system,
      messages: [{ role: "user", content: sample }],
      maxTokens: 1200,
      temperature: 0.4,
      callerMemberId: me.memberId,
      skipTrace: true,   // 保存前の試走はトレースに残さない
    });

    const res: AiPromptPreviewRes = {
      preview,
      expanded: built.system,
      roleChars: built.role.length,
      unknownKeys: built.unknownKeys,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}

/** パーツを試すときの試走先。参照している機能のうち先頭を使う */
function pickFeatureFor(key: string, _view: string): AiFeature {
  const target = key === "view_support" || key === "view_holder" ? "view" : key;
  const hit = PROMPT_FEATURES.find(({ feature }) =>
    refPartsOf(DEFAULT_PROMPTS[feature] ?? "").includes(target));
  return hit?.feature ?? "reply_suggest";
}
