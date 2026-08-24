// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// 取込オーケストレータ（フェーズB / 正本 §9-§10）
//   ・SourceFile（note/x）→ ParsedDoc（文書→単位→chunk）へ。
//   ・chat_bookmark は既存の chat_bookmarks から別途マップする（B-3）。
// ============================================================
import { parseNote, parseX } from "./chunk";
import type { ParsedDoc, SourceFile } from "./types";

export * from "./types";
export { parseFrontmatter, classifyNote, classifyX } from "./classify";
export { parseNote, parseX, estimateTokens, chunkMarkdown } from "./chunk";

/** note / x のソースファイルを解析して中間表現へ。 */
export function parseSourceFile(f: SourceFile): ParsedDoc {
  if (f.sourceType === "note") return parseNote(f.relativePath, f.content);
  if (f.sourceType === "x") return parseX(f.relativePath, f.content);
  // content / news はファイルではなく DB から取り込む（portalDocs.ts）。
  throw new Error(`parseSourceFile: ${f.sourceType} はファイル取込に対応していません`);
}

/** 検索対象にできる chunk があるか（canonical かつ retrieval 可能）。 */
export function hasRetrievableChunks(doc: ParsedDoc): boolean {
  if (doc.retrievalMode === "excluded") return false;
  return doc.units.some((u) => u.chunks.length > 0);
}
