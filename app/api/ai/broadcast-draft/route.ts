// ============================================================
// ⑤ 配信原稿の生成（一斉配信 / シナリオ配信）
//
//    ★ 一斉配信は取り返しがつかない。
//       - AIは send API を呼ばない（生成物は messageBody の state に入るだけ）
//       - 日付・金額・URLは「伝えたいこと」に書かれた値以外を創作させない
//       - プロンプトに入れるのは属性の「集計値」だけ（個人情報は渡さない）
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput, parseJsonOrThrow } from "../../../../lib/ai/claude";
import { loadAttrTree, computeAudience, audienceBlock } from "../../../../lib/ai/context";
import { BROADCAST_VARIABLES } from "../../../../lib/models";
import {
  BC_PURPOSE_LABEL, BC_TONE_LABEL, BC_LENGTH_LABEL, BC_EMOJI_LABEL,
} from "../../../../lib/ai/types";
import type {
  BcDraft, BcWarning, BroadcastDraftReq, BroadcastDraftRes,
} from "../../../../lib/ai/types";

interface ModelDraft { label?: string; approach?: string; text?: string }
interface ModelWarn { level?: string; message?: string }
interface ModelOut { drafts?: ModelDraft[]; warnings?: ModelWarn[] }

const TOKENS = BROADCAST_VARIABLES.map((v) => v.token);
const TOKEN_RE = /\{\{[^}]+\}\}/g;

const buildSystem = (useVars: boolean): string => `あなたは KAWAI CAMP の配信原稿ライターです。

【差し込み変数】${useVars ? `以下のみ使用可。他は絶対に創作しない。\n${TOKENS.join(" ")}` : "使用しない（本文に {{...}} を書かない）"}

【厳守】
- 日付・金額・URL は「伝えたいこと」に書かれた値のみ使う。書かれていない値を補完・創作しない
- 配信先の属性内訳に矛盾する断定をしない
  （例: 全員が初参加とは限らないなら「初めての方は」と条件付き表現にする）
- 3案は方針を変える：「共感型」「要点型」「締切訴求」
- 配信先と文面に齟齬がありそうなら warnings に書く

【出力】
必ず次の JSON のみを返す（前置き・コードフェンス禁止）:
{
  "drafts": [
    { "label": "案 A", "approach": "共感型", "text": "本文" },
    { "label": "案 B", "approach": "要点型", "text": "本文" },
    { "label": "案 C", "approach": "締切訴求", "text": "本文" }
  ],
  "warnings": [
    { "level": "warn", "message": "「初めてのご参加」と書かれていますが、対象128名中3名はリピーターです" }
  ]
}`;

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = (await request.json()) as BroadcastDraftReq;

    const points = clampInput(body?.points ?? "");
    if (!points) throw new HttpError(400, "「伝えたいこと」を入力してください");

    await checkRateLimit(me.memberId, "broadcast_draft", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const tree = await loadAttrTree();
    const audience = await computeAudience(body.target, tree);

    const user = [
      body.useAudience ? `## 配信先（実データから集計・個人情報は含まない）\n${audienceBlock(audience)}` : "## 配信先\n（条件を反映しない）",
      "",
      "## 条件",
      `目的: ${BC_PURPOSE_LABEL[body.purpose] ?? body.purpose}`,
      `トーン: ${BC_TONE_LABEL[body.tone] ?? body.tone}`,
      `長さ: ${BC_LENGTH_LABEL[body.length] ?? body.length}`,
      `絵文字: ${BC_EMOJI_LABEL[body.emoji] ?? body.emoji}`,
      "",
      "## 伝えたいこと（この内容の範囲でのみ書くこと）",
      points,
      "",
      "## 依頼",
      "上記をもとに、チャット／メールで配信する原稿を3案つくってください。",
    ].join("\n");

    const raw = await callClaude({
      feature: "broadcast_draft",
      system: buildSystem(body.useVariables),
      messages: [{ role: "user", content: user }],
      maxTokens: 2500,
      temperature: 0.7,
      callerMemberId: me.memberId,
    });
    const out = parseJsonOrThrow<ModelOut>(raw);

    const labels = ["案 A", "案 B", "案 C"];
    const drafts: BcDraft[] = (out.drafts ?? [])
      .filter((d) => (d.text ?? "").trim())
      .slice(0, 3)
      .map((d, i) => ({
        label: (d.label ?? "").trim() || labels[i] || `案 ${i + 1}`,
        approach: (d.approach ?? "").trim() || "標準",
        text: (d.text ?? "").trim(),
      }));
    if (drafts.length === 0) throw new HttpError(502, "原稿を生成できませんでした。もう一度お試しください。");

    const warnings: BcWarning[] = (out.warnings ?? [])
      .filter((w) => (w.message ?? "").trim())
      .slice(0, 6)
      .map((w) => ({
        level: w.level === "warn" ? "warn" : w.level === "ok" ? "ok" : "info",
        message: (w.message ?? "").trim(),
      }));

    // ── 変数の破損チェック（AIが存在しない変数を作っていないか）──
    for (const d of drafts) {
      const used = d.text.match(TOKEN_RE) ?? [];
      const unknown = Array.from(new Set(used.filter((t) => !TOKENS.includes(t))));
      if (unknown.length > 0) {
        warnings.push({
          level: "warn",
          message: `${d.label}: 未定義の差し込み変数 ${unknown.join(" ")} が含まれています（置換されず、そのまま配信されます）`,
        });
      }
    }

    const res: BroadcastDraftRes = {
      drafts,
      warnings,
      audience: { total: audience.total, breakdown: audience.breakdown },
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
