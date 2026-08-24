// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// 文書解析・分割（正本 database-spec.md §10）
//   ・note: frontmatter/本文/見出しを分離し、H2/H3 の階層を保って chunk 化。
//   ・X: 単発=1投稿1unit、シリーズ=## Day / 共通CTA で発言単位に分割。
//   ・純粋関数。埋め込み・DB upsert は ingest（B-3）で行う。
// ============================================================
import { parseFrontmatter, classifyNote, classifyX } from "./classify";
import type { ParsedChunk, ParsedDoc, ParsedUnit, ChunkKind, FreshnessClass } from "./types";

// ── 小さなユーティリティ ──────────────────────────────────────
/** ざっくりトークン数（日本語想定：約2文字/トークン）。 */
export function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil([...s].length / 2));
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function firstH1(body: string): string | null {
  const m = body.match(/^#\s+(.*)$/m);
  return m ? m[1].trim() : null;
}

function detectChunkKind(text: string): ChunkKind {
  const lines = text.split(/\r?\n/);
  const listLines = lines.filter((l) => /^\s*(✅|[-*・]|\d+[.)、])/.test(l)).length;
  if (listLines >= 2) return "list";
  if (/https?:\/\//.test(text) && /(リプ|誘導|CTA|申込|問い合わせ)/.test(text)) return "cta";
  return "prose";
}

/** 鮮度クラス（正本 §9.4）。最新性が問われる話題は volatile。 */
function detectFreshness(content: string): FreshnessClass | null {
  if (/(対応|最新|リリース|発表|アップデート|正式)/.test(content) && /\d/.test(content)) return "volatile";
  return null;
}

function oneChunk(text: string, kind: ChunkKind): ParsedChunk {
  const t = text.trim();
  return { ordinal: 0, headingPath: [], chunkKind: kind, text: t, startChar: 0, endChar: t.length, tokenCount: estimateTokens(t) };
}

interface Block { text: string; start: number; end: number }
function splitBlocks(body: string): Block[] {
  const out: Block[] = [];
  let cursor = 0;
  for (const part of body.split(/\r?\n\s*\r?\n/)) {
    const t = part.trim();
    if (!t) continue;
    const found = body.indexOf(t, cursor);
    const start = found >= 0 ? found : cursor;
    out.push({ text: t, start, end: start + t.length });
    cursor = start + t.length;
  }
  return out;
}

// ── note 本文の chunk 化 ──────────────────────────────────────
const CHUNK_TARGET_TOKENS = 900;

/**
 * 見出し（# / ## / ###）と空行で区切って chunk 化する。
 *   note 本文用に作ったが、会員ポータルの資料・お知らせ（HTML→Markdown 変換後）でも使う。
 */
export function chunkMarkdown(body: string): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  const headingPath: string[] = [];
  let buf: Block[] = [];
  let ord = 0;

  const flush = (): void => {
    if (buf.length === 0) return;
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (!first || !last) { buf = []; return; }
    const text = buf.map((b) => b.text).join("\n\n");
    chunks.push({
      ordinal: ord++, headingPath: [...headingPath], chunkKind: detectChunkKind(text),
      text, startChar: first.start, endChar: last.end, tokenCount: estimateTokens(text),
    });
    buf = [];
  };

  for (const b of splitBlocks(body)) {
    const h = b.text.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      headingPath.length = level - 1;      // 親までを残す
      headingPath[level - 1] = h[2].trim();
      continue;
    }
    buf.push(b);
    if (estimateTokens(buf.map((x) => x.text).join("\n\n")) >= CHUNK_TARGET_TOKENS) flush();
  }
  flush();
  return chunks;
}

// ── note ファイル → ParsedDoc ─────────────────────────────────
export function parseNote(relativePath: string, content: string): ParsedDoc {
  const { fm, body } = parseFrontmatter(content);
  const cls = classifyNote(fm, body);
  const title = (fm.title && fm.title.trim()) || firstH1(body) || null;
  const normalizedText = normalize(body);
  const canonical = cls.ingestionRole === "canonical";

  const unit: ParsedUnit = {
    unitKind: "article", ordinal: 0, title, body: normalizedText,
    speaker: "kawai", isAuthorVoice: cls.isAuthorVoice, retrievalMode: cls.retrievalMode,
    freshnessClass: null, chunks: canonical ? chunkMarkdown(body) : [],
  };
  return {
    sourceType: "note", relativePath, externalId: fm.guid || null, canonicalUrl: fm.url || null,
    title, rawText: content, normalizedText,
    publicationStatus: cls.publicationStatus, visibility: cls.visibility,
    documentKind: "article", isAuthorVoice: cls.isAuthorVoice, retrievalMode: cls.retrievalMode,
    units: [unit],
  };
}

// ── X ファイル → ParsedDoc ────────────────────────────────────
function fencedText(section: string): string | null {
  const m = section.match(/```text\r?\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}
function stripHeading(section: string): string {
  return section.replace(/^##[^\n]*\n?/, "").trim();
}

function singleUnits(content: string): ParsedUnit[] {
  const body = normalize(content);
  return [{
    unitKind: "post", ordinal: 0, title: null, body,
    speaker: "kawai", isAuthorVoice: true, retrievalMode: "answer_and_style",
    freshnessClass: detectFreshness(content),
    chunks: [oneChunk(body, detectChunkKind(body))],
  }];
}

function seriesUnits(content: string): ParsedUnit[] {
  const sections = content.split(/\r?\n(?=##\s)/);
  const units: ParsedUnit[] = [];
  let ord = 0;

  // 共通CTAリプ（文体用に style_only）
  const ctaSec = sections.find((s) => /^##\s*共通CTAリプ/.test(s.trim()));
  const ctaText = ctaSec ? fencedText(ctaSec) : null;
  if (ctaText) {
    units.push({
      unitKind: "cta", ordinal: ord++, title: "共通CTAリプ", body: ctaText,
      speaker: "kawai", isAuthorVoice: true, retrievalMode: "style_only",
      freshnessClass: null, chunks: [oneChunk(ctaText, "cta")],
    });
  }
  // 各 Day を発言単位へ
  for (const s of sections) {
    const dm = s.trim().match(/^##\s*Day\s*(\d+)/);
    if (!dm) continue;
    const body = fencedText(s) ?? stripHeading(s);
    if (!body) continue;
    units.push({
      unitKind: "thread_post", ordinal: ord++, title: `Day ${dm[1]}`, body,
      speaker: "kawai", isAuthorVoice: true, retrievalMode: "answer_and_style",
      freshnessClass: null, chunks: [oneChunk(body, detectChunkKind(body))],
    });
  }
  return units;
}

export function parseX(relativePath: string, content: string): ParsedDoc {
  const cls = classifyX(content);
  const isSeries = /(^|\n)##\s*Day\s*\d+/.test(content);
  const canonical = cls.ingestionRole === "canonical";
  const units = canonical ? (isSeries ? seriesUnits(content) : singleUnits(content)) : [];

  return {
    sourceType: "x", relativePath, externalId: null, canonicalUrl: null,
    title: isSeries ? firstH1(content) : null,
    rawText: content, normalizedText: normalize(content),
    publicationStatus: cls.publicationStatus, visibility: cls.visibility,
    documentKind: isSeries ? "series" : "post_file",
    isAuthorVoice: cls.isAuthorVoice, retrievalMode: cls.retrievalMode,
    units,
  };
}
