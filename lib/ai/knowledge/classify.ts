// ============================================================
// 取込分類（正本 database-spec.md §9）
//   ・note は frontmatter.status で公開状態を確定（fixture / 実データ共通）。
//   ・X の現行投稿は公開・本人発言として扱う。
//   ・有料/内部/不明の分離、公開可否と回答利用可否(retrieval_mode)を分けて持つ。
// ============================================================
import type { Classification, NoteFrontmatter } from "./types";

/** frontmatter（--- で囲まれた先頭ブロック）と本文を分離する。 */
export function parseFrontmatter(raw: string): { fm: NoteFrontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: raw };
  const fm: NoteFrontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1];
    const val = mm[2].trim().replace(/^["']|["']$/g, "");
    if (key === "title" || key === "date" || key === "url" || key === "guid" || key === "status") {
      fm[key] = val;
    }
  }
  return { fm, body: raw.slice(m[0].length) };
}

/** note の可視性（正本 §9.2）。有料誘導マーカーがあれば mixed。 */
function noteVisibility(status: string, body: string): { visibility: Classification["visibility"]; mixed: boolean } {
  const paidMarker = body.includes("メンバーシップの方はこの記事を全文無料で閲覧できます。")
    || body.includes("ここから先は")
    || body.includes("この続きをみるには");
  if (paidMarker) return { visibility: "mixed", mixed: true };
  if (status === "publish") return { visibility: "public", mixed: false };
  if (status === "draft") return { visibility: "internal", mixed: false };
  return { visibility: "unknown", mixed: false };
}

/** note ファイルの分類。 */
export function classifyNote(fm: NoteFrontmatter, body: string): Classification {
  const status = (fm.status ?? "").trim();
  const { visibility, mixed } = noteVisibility(status, body);

  if (status === "publish") {
    return {
      itemClass: "primary_text",
      ingestionRole: "canonical",
      retrievalMode: mixed ? "paraphrase_only" : "answer_and_style",
      isAuthorVoice: true,
      publicationStatus: "published",
      visibility,
      reason: mixed ? "note publish（有料mixed→paraphrase_only）" : "note status=publish",
    };
  }
  if (status === "draft") {
    return {
      itemClass: "primary_text", ingestionRole: "excluded", retrievalMode: "excluded",
      isAuthorVoice: true, publicationStatus: "draft", visibility: "internal",
      reason: "note status=draft（検索除外）",
    };
  }
  // frontmatter なし / status 不明 → needs_review かつ除外
  return {
    itemClass: "primary_text", ingestionRole: "needs_review", retrievalMode: "excluded",
    isAuthorVoice: false, publicationStatus: "unknown", visibility: "unknown",
    reason: "note status 不明（needs_review・除外）",
  };
}

/** X ファイルの分類。現行投稿は公開・本人発言。 */
export function classifyX(content: string): Classification {
  const isSeries = /(^|\n)##\s*Day\s*\d+/.test(content);
  const draftMarker = /^(status:\s*draft|公開状態:\s*非公開)$/m.test(
    content.split(/\r?\n/).slice(0, 20).join("\n"),
  );
  if (draftMarker) {
    return {
      itemClass: "primary_text", ingestionRole: "excluded", retrievalMode: "excluded",
      isAuthorVoice: true, publicationStatus: "draft", visibility: "internal",
      reason: "x 先頭に draft マーカー（除外）",
    };
  }
  return {
    itemClass: "primary_text", ingestionRole: "canonical", retrievalMode: "answer_and_style",
    isAuthorVoice: true, publicationStatus: "published", visibility: "public",
    reason: isSeries ? "x series（公開）" : "x single（公開）",
  };
}
