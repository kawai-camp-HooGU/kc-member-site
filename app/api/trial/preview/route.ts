// ============================================================
// POST /api/trial/preview — 実際に渡る内容を見る／試しに作る（運営専用）
//
//   ★ プレビューは本番と同じ組み立てを通す。片方だけ別経路にすると
//     「プレビューでは通るのに本番で違う」状態になる。
//
//   ⚠️ 画像とテキストで経路が違う。ここを取り違えると画面が嘘をつく。
//      ・画像 … buildImagePrompt() で組み立て、system も wrap も付けずに
//               そのまま画像APIへ渡す（2026-09-01 にこの形へ変更）
//      ・テキスト/HTML … buildTrialPrompt() で system + wrap 付きの2本を作る
//
//   ⚠️ 運営専用（requireOps）。テンプレプロンプトは公開してよい情報ではない。
//   ⚠️ run=true は実際に課金が走る。レート制限を必ず通す。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaudeEx, checkRateLimit } from "../../../../lib/ai/claude";
import { callImage, type ImageQuality } from "../../../../lib/ai/image";
import { sanitizeHtml, stripCodeFence } from "../../../../lib/ai/sanitize";
import {
  buildImagePrompt, buildTrialPrompt, normalizeInputs, refineImagePrompt,
  type ScenarioRow,
} from "../../../../lib/bot/trial/trialServer";
import type {
  TrialImageSize, TrialInputDef, TrialOutputKind,
} from "../../../../lib/bot/trial/types";

export const runtime = "nodejs";
/** ⚠️ 既定のままだと途中で打ち切られる（試し生成でAIを呼ぶ）。 */
export const maxDuration = 300;

interface StepBody {
  key: string; label: string; prompt: string;
  inputs: TrialInputDef[]; imageSize?: TrialImageSize; refinePrompt?: boolean;
}
interface DraftBody {
  title?: string;
  output_kind?: TrialOutputKind;
  steps?: StepBody[];
  model?: string;
  max_tokens?: number;
}
interface Body {
  draft?: DraftBody;
  stepIndex?: number;
  values?: Record<string, string>;
  run?: boolean;
  /** 画像のときの画質。試し生成の費用に直結する */
  quality?: ImageQuality;
}

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = (await request.json().catch(() => ({}))) as Body;

    const draft = body.draft ?? {};
    const steps = draft.steps ?? [];
    const idx = Number.isFinite(body.stepIndex) ? Number(body.stepIndex) : 0;
    const step = steps[idx];
    if (!step) throw new HttpError(400, "ステップが指定されていません");
    if (!(step.prompt ?? "").trim()) throw new HttpError(400, "プロンプトが空です");

    const kind: TrialOutputKind = draft.output_kind ?? "html";
    // ⚠️ 差し込み値は本番と同じ normalizeInputs を通す
    const inputs = normalizeInputs(step.inputs ?? [], body.values ?? {});

    // ── 画像 ──────────────────────────────────────────────
    if (kind === "image") {
      const raw = buildImagePrompt({ step, inputs, instruction: "" });
      // ⚠️ 本番と同じ判断。ここだけ別にすると画面が嘘をつく。
      const doRefine = step.refinePrompt !== false;

      // 書き直しは Claude を1回呼ぶ。見るだけでも本番と同じものを見せたいので、ここでも呼ぶ。
      // ⚠️ 外部APIを1回でも呼ぶときだけ上限を数える（書き直し無し＋見るだけ＝呼ばない）。
      if (doRefine || body.run) {
        await checkRateLimit(me.memberId, "trial_preview", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));
      }
      const r = doRefine
        ? await refineImagePrompt({ raw, callerMemberId: me.memberId })
        : { prompt: raw, refined: false, traceId: null };
      const imagePrompt = r.prompt;

      if (!body.run) {
        return NextResponse.json({
          system: "", user: raw, refined: r.refined ? imagePrompt : undefined, mode: "image",
        });
      }
      // ⚠️ 既定は high。本番の既定（toQuality）と揃える。medium 以下は日本語が崩れる。
      const quality: ImageQuality =
        body.quality === "low" || body.quality === "medium" || body.quality === "high"
          ? body.quality : "high";

      const img = await callImage({
        feature: "trial_preview",
        prompt: imagePrompt,
        size: step.imageSize ?? "1536x1024",
        quality,
        callerMemberId: me.memberId,
      });
      // ⚠️ 試し生成は Storage へ保存しない。運営が見て捨てるだけのものなので、
      //    体験の成果物と同じ置き場に混ぜない。
      return NextResponse.json({
        system: "", user: raw, refined: r.refined ? imagePrompt : undefined, mode: "image",
        imageDataUrl: `data:${img.mime};base64,${img.b64}`,
        costJpy: img.costJpy,
      });
    }

    // ── テキスト / HTML ───────────────────────────────────
    const maxTokens = Math.min(Math.max(Number(draft.max_tokens ?? 1800), 200), 8000);
    const scenario = {
      id: 0, slug: "", title: draft.title ?? "", intro: "", cta_label: "",
      output_kind: kind, step_limit: steps.length, revise_limit: 0,
      form_timing: "none", form_id: null,
      steps: [], review: {}, model: draft.model || null,
      max_tokens: maxTokens, is_deleted: false,
    } as unknown as ScenarioRow;

    const built = await buildTrialPrompt({
      scenario,
      step: { key: step.key, label: step.label, prompt: step.prompt, inputs: step.inputs },
      inputs,
      prevBody: "",
      instruction: "",
    });

    if (!body.run) {
      return NextResponse.json({ system: built.system, user: built.user, mode: "text" });
    }

    await checkRateLimit(me.memberId, "trial_preview", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const res = await callClaudeEx({
      feature: "trial_preview",
      system: built.system,
      messages: [{ role: "user", content: built.user }],
      maxTokens,
      model: draft.model || undefined,
      callerMemberId: me.memberId,
      userInput: JSON.stringify(inputs),
    });

    let output = stripCodeFence(res.text);
    if (kind === "html" || kind === "pdf") output = sanitizeHtml(output).html;

    return NextResponse.json({ system: built.system, user: built.user, output, mode: "text" });
  } catch (err) {
    return errorResponse(err);
  }
}
