// ============================================================
// ④ コンテンツ本文 HTML の生成 / 部分修正
//
//    ★ XSS が最大リスク。防御は3層：
//       ① system プロンプトのホワイトリスト（弱い防御）
//       ② サーバー側 sanitizeHtml（本命・AI出力を信用しない）
//       ③ 保存時の再サニタイズ（lib/contents.ts 側）
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput } from "../../../../lib/ai/claude";
import { loadPrompt, htmlContract } from "../../../../lib/ai/prompts";
import { sanitizeHtml, stripCodeFence } from "../../../../lib/ai/sanitize";
import type { HtmlGenerateReq, HtmlGenerateRes } from "../../../../lib/ai/types";

const MAX_HTML_CHARS = 12000;

export async function POST(request: Request) {
  try {
    const me = await requireAdmin(request);
    const body = (await request.json()) as HtmlGenerateReq;

    const instruction = clampInput(body?.instruction ?? "");
    if (!instruction) throw new HttpError(400, "指示を入力してください");

    await checkRateLimit(me.memberId, "html_generate", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const currentHtml = (body.currentHtml ?? "").slice(0, MAX_HTML_CHARS);

    // 選択範囲は必ずサーバー側で妥当性を検証する（範囲外なら全体扱い）
    const raw = body.selection ?? null;
    const range: { start: number; end: number } | null =
      raw != null &&
      Number.isFinite(raw.start) && Number.isFinite(raw.end) &&
      raw.end > raw.start && raw.start >= 0 && raw.end <= currentHtml.length
        ? { start: raw.start, end: raw.end }
        : null;
    const selected = range ? currentHtml.slice(range.start, range.end) : "";

    // トーン統一のため、既存コンテンツのHTMLを2件だけ例示
    const { data: samples } = await supabaseAdmin
      .from("contents")
      .select("id, body_html")
      .eq("is_deleted", false)
      .eq("none_mode", "html")
      .neq("body_html", "")
      .limit(2);

    const sampleBlock = (samples ?? [])
      .map((s) => `[content:${s.id}] ${(s.body_html ?? "").slice(0, 600)}`)
      .join("\n");

    const user = [
      "## 現在の本文HTML（全文）",
      currentHtml || "（空です。新規作成してください）",
      "",
      range
        ? `## 修正対象（この範囲だけを書き換える）\n<selection>\n${selected}\n</selection>`
        : "## 修正対象\n（未選択のため、指示に応じて追記または全体を書き換える）",
      "",
      sampleBlock ? `## 参考：既存コンテンツのHTML（トーン統一のため）\n${sampleBlock}\n` : "",
      "## 指示",
      instruction,
      "",
      range
        ? "※ <selection> を置き換える HTML断片のみを返してください。"
        : "※ 本文HTML全体を返してください。",
    ].join("\n");

    const answer = await callClaude({
      feature: "html_generate",
      system: (await loadPrompt("html_generate")) + htmlContract(),
      messages: [{ role: "user", content: user }],
      maxTokens: 3000,
      temperature: 0.3,
      callerMemberId: me.memberId,
    });

    // ★ AIの遵守を信用せず、必ず機械的にサニタイズする
    const { html, info } = sanitizeHtml(stripCodeFence(answer));
    if (!html) throw new HttpError(502, "HTMLを生成できませんでした。指示を具体的にしてお試しください。");

    const res: HtmlGenerateRes = {
      html,
      sanitized: info,
      replaceRange: range,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
