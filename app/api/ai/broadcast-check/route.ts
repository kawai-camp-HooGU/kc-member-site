// ============================================================
// ⑤ 配信前チェック（原稿だけを渡して検査）
//    機械的に判定できるものはAIを使わずここで判定する。
//    「宛先と文面の齟齬」だけAIに見てもらう。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput, parseJson } from "../../../../lib/ai/claude";
import { loadAttrTree, computeAudience, audienceBlock } from "../../../../lib/ai/context";
import { BROADCAST_VARIABLES } from "../../../../lib/models";
import type { BcWarning, BroadcastCheckReq, BroadcastCheckRes } from "../../../../lib/ai/types";

const TOKENS = BROADCAST_VARIABLES.map((v) => v.token);
const TOKEN_RE = /\{\{[^}]+\}\}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/g;

const SYSTEM = `あなたは KAWAI CAMP の配信前チェック係です。
配信原稿と、配信先の属性内訳（集計値）を突き合わせ、齟齬を指摘してください。

【見るポイント】
- 文面が特定の属性を前提にしているのに、対象にそうでない人が含まれていないか
  （例：「初めてのご参加」と書いてあるが、リピーターが3名含まれる）
- 日付の曜日表記が実在するか（今日の日付を基準に判断）
- 明らかに不足している情報（申込先・期限など）

【出力】
必ず次の JSON のみを返す:
{ "checks": [ { "level": "warn", "message": "…" } ] }
問題が無ければ checks は空配列。`;

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = (await request.json()) as BroadcastCheckReq;

    const text = clampInput(body?.messageBody ?? "");
    if (!text) throw new HttpError(400, "本文が空です");

    const checks: BcWarning[] = [];

    // ── 機械チェック（AI不要）──
    const used = text.match(TOKEN_RE) ?? [];
    const unknown = Array.from(new Set(used.filter((t) => !TOKENS.includes(t))));
    if (unknown.length > 0) {
      checks.push({ level: "warn", message: `未定義の差し込み変数 ${unknown.join(" ")} があります（置換されません）` });
    } else if (used.length > 0) {
      checks.push({ level: "ok", message: `差し込み変数の記法は正しいです（${used.length}箇所）` });
    }

    const urls = Array.from(new Set(text.match(URL_RE) ?? []));
    if (urls.length > 0) {
      checks.push({ level: "ok", message: `URL ${urls.length}件（クリック計測が付与されます）` });
    }

    const tree = await loadAttrTree();
    const audience = await computeAudience(body.target, tree);
    checks.push({ level: "info", message: `配信対象：${audience.total}名` });

    // ── AIチェック（宛先と文面の齟齬）──
    try {
      await checkRateLimit(me.memberId, "broadcast_draft", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));
      const raw = await callClaude({
        feature: "broadcast_draft",
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
            "",
            "## 配信先（集計）",
            audienceBlock(audience),
            "",
            "## 配信原稿",
            "<broadcast>",
            text,
            "</broadcast>",
          ].join("\n"),
        }],
        maxTokens: 800,
        temperature: 0.2,
        callerMemberId: me.memberId,
      });
      const out = parseJson<{ checks?: { level?: string; message?: string }[] }>(raw);
      for (const c of out?.checks ?? []) {
        const msg = (c.message ?? "").trim();
        if (!msg) continue;
        checks.push({ level: c.level === "warn" ? "warn" : c.level === "ok" ? "ok" : "info", message: msg });
      }
    } catch {
      // AIチェックが失敗しても機械チェックの結果は返す
      checks.push({ level: "info", message: "AIチェックは実行できませんでした（機械チェックのみ表示）" });
    }

    const res: BroadcastCheckRes = { checks };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
