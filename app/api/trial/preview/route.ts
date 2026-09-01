// ============================================================
// POST /api/trial/preview — プロンプトの組み立て結果を見る（運営専用）
//
//   ★ プロンプトを画面で編集できるようにした以上、
//     「実際に何がAIへ渡るのか」を保存前に確かめられないと調整ができない。
//     組み立ては buildTrialPrompt() を使う＝本番とまったく同じ経路で作る。
//
//   ⚠️ 運営専用（requireOps）。テンプレプロンプトは公開してよい情報ではない。
//   ⚠️ run=true は実際に課金が走る。レート制限を必ず通す。
//   ⚠️ 保存前の下書きを受け取るので、DBは読まない（画面の内容そのままで組み立てる）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaudeEx, checkRateLimit } from "../../../../lib/ai/claude";
import { sanitizeHtml, stripCodeFence } from "../../../../lib/ai/sanitize";
import {
  buildTrialPrompt, normalizeInputs, type ScenarioRow,
} from "../../../../lib/bot/trial/trialServer";
import type { TrialInputDef, TrialOutputKind } from "../../../../lib/bot/trial/types";

export const runtime = "nodejs";
/** ⚠️ 既定のままだと途中で打ち切られる（試し生成でAIを呼ぶ）。 */
export const maxDuration = 300;

interface StepBody { key: string; label: string; prompt: string; inputs: TrialInputDef[] }
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
    const maxTokens = Math.min(Math.max(Number(draft.max_tokens ?? 1800), 200), 8000);

    // ⚠️ 差し込み値は本番と同じ normalizeInputs を通す。
    //    ここだけ緩めると「プレビューでは通るのに本番で違う」状態になる。
    const inputs = normalizeInputs(step.inputs ?? [], body.values ?? {});

    // buildTrialPrompt はシナリオ行を取るので、下書きから最小限の形を作る
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
      return NextResponse.json({ system: built.system, user: built.user });
    }

    // ── 試し生成（費用が発生する）──
    //   ⚠️ 運営の日次上限を通す。プロンプト調整で何十回も回されると効いてくる。
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

    // 画面へ返す前に本番と同じ後始末をする（見え方を本番と一致させる）
    let output = stripCodeFence(res.text);
    if (kind === "html" || kind === "pdf") output = sanitizeHtml(output).html;

    return NextResponse.json({ system: built.system, user: built.user, output });
  } catch (err) {
    return errorResponse(err);
  }
}
