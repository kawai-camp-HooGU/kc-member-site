// ============================================================
// ⑧ セクション扉ページ HTML の生成 / 部分修正
//
//    ④HTML生成（本文）とは別機能。許可タグ・使うclass・データ注入が違う。
//
//    ★ XSS が最大リスク。防御は3層（④と同じ構造）：
//       ① system プロンプトのホワイトリスト（弱い防御）
//       ② サーバー側 sanitizeDoorHtml（本命・AI出力を信用しない）
//       ③ 保存時の再サニタイズ（SectionManager → lib/contents.ts 側）
//
//    ★ slug は AI に創作させない。
//       resolveDoorHtml() は存在しない slug の要素を丸ごと除去するため、
//       創作されると「生成物が会員画面から消える」原因の分かりにくい不具合になる。
//       → セクション配下のページを実データとして user メッセージに渡す。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput } from "../../../../lib/ai/claude";
import { loadPromptBundle, doorContract } from "../../../../lib/ai/prompts";
import { wrap } from "../../../../lib/ai/context";
import { stripCodeFence } from "../../../../lib/ai/sanitize";
import { sanitizeDoorHtml, DOOR_HTML_MAX } from "../../../../lib/ai/sanitizeDoor";
import type { DoorGenerateReq, DoorGenerateRes } from "../../../../lib/ai/types";

/** AIへ渡す現在HTMLの上限。DOOR_HTML_MAX(64KB) は system が入らないので別枠で絞る */
const MAX_INPUT_HTML = 16000;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const me = await requireAdmin(request);
    const body = (await request.json()) as DoorGenerateReq;

    const instruction = clampInput(body?.instruction ?? "");
    if (!instruction) throw new HttpError(400, "指示を入力してください");

    const sectionId = Number(body?.sectionId ?? 0);
    if (!Number.isFinite(sectionId) || sectionId <= 0) {
      throw new HttpError(400, "セクションを保存してから実行してください");
    }

    await checkRateLimit(me.memberId, "door_generate", Number(process.env.AI_OPS_DAILY_LIMIT ?? 200));

    const currentHtml = (body.currentHtml ?? "").slice(0, MAX_INPUT_HTML);

    // 選択範囲は必ずサーバー側で妥当性を検証する（範囲外なら全体扱い）
    const raw = body.selection ?? null;
    const range: { start: number; end: number } | null =
      raw != null &&
      Number.isFinite(raw.start) && Number.isFinite(raw.end) &&
      raw.end > raw.start && raw.start >= 0 && raw.end <= currentHtml.length
        ? { start: raw.start, end: raw.end }
        : null;
    const selected = range ? currentHtml.slice(range.start, range.end) : "";

    // ★ このセクションに所属するページ（slug の正本）。
    //   ここに無い slug をAIが書いても、描画時に要素ごと消える。
    const { data: pageRows } = await supabaseAdmin
      .from("content_pages")
      .select("id, name, slug, published")
      .eq("section_id", sectionId)
      .eq("is_deleted", false)
      .order("sort_order")
      .order("id");

    const pages = (pageRows ?? []).filter((p) => (p.slug ?? "").trim());
    const pageBlock = pages.length > 0
      ? pages.map((p) => `${p.slug} ｜ ${p.name ?? ""} ｜ ${p.published ? "公開" : "非公開"}`).join("\n")
      : "（slug が設定されたページがありません）";

    // セクション名（見出しの文言をAIが揃えられるように渡す）
    const { data: sec } = await supabaseAdmin
      .from("content_sections")
      .select("name, overview")
      .eq("id", sectionId)
      .maybeSingle();

    const user = [
      `## セクション\n${sec?.name ?? "（不明）"}${sec?.overview ? `\n概要: ${sec.overview}` : ""}`,
      "",
      "## このセクションで使えるページ（slug ｜ ページ名 ｜ 公開状態）",
      "※ ここに無い slug は絶対に使わないこと。data-page / {{count:}} / {{name:}} は必ずこの slug から選ぶ。",
      pageBlock,
      "",
      "## 現在の扉ページHTML（全文）",
      currentHtml || "（空です。新規作成してください）",
      "",
      range
        ? `## 修正対象（この範囲だけを書き換える）\n${wrap("selection", selected)}`
        : "## 修正対象\n（未選択のため、指示に応じて追記または全体を書き換える）",
      "",
      "## 指示",
      instruction,
      "",
      range
        ? "※ <selection> を置き換える HTML断片のみを返してください。"
        : "※ 扉ページHTML全体を返してください。",
    ].join("\n");

    const p = await loadPromptBundle("door_generate");
    const answer = await callClaude({
      feature: "door_generate",
      system: p.system + doorContract(),
      messages: [{ role: "user", content: user }],
      maxTokens: 4000,
      model: p.model ?? undefined,
      temperature: p.temperature ?? 0.3,
      promptVersion: p.version,
      callerMemberId: me.memberId,
      userInput: instruction,
      startedAt: started,
    });

    // ★ AIの遵守を信用せず、必ず機械的にサニタイズする（扉用プロファイル）
    const { html, info } = sanitizeDoorHtml(stripCodeFence(answer));
    if (!html) throw new HttpError(502, "HTMLを生成できませんでした。指示を具体的にしてお試しください。");

    // 保存できない大きさのものは返さない（画面で詰まらせない）
    if (!range && html.length > DOOR_HTML_MAX) {
      throw new HttpError(502, `生成結果が大きすぎます（${html.length.toLocaleString()}字／上限 ${DOOR_HTML_MAX.toLocaleString()}字）。範囲を分けて指示してください。`);
    }

    const res: DoorGenerateRes = {
      html,
      sanitized: info,
      replaceRange: range,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
