// ============================================================
// KAWAI ナレッジ取込：共有型（フェーズB / 正本 database-spec.md 準拠）
//   ・ファイル → 文書(document) → 発言単位(unit) → 検索断片(chunk) の中間表現。
//   ・ここは純粋な変換ロジック用の型。DB upsert は ingest（B-3）で行う。
// ============================================================

export type SourceType = "note" | "x" | "chat_bookmark";

export type ItemClass = "primary_text" | "support_text" | "verification" | "media" | "other";
export type IngestionRole = "canonical" | "support" | "evidence" | "asset" | "excluded" | "needs_review";
export type RetrievalMode =
  | "answer_and_style" | "answer_only" | "style_only"
  | "evidence_only" | "paraphrase_only" | "excluded";
export type PublicationStatus = "published" | "draft" | "unknown" | "archived";
export type Visibility = "public" | "paid" | "mixed" | "internal" | "unknown";
export type Speaker = "kawai" | "external" | "system" | "unknown";
export type DocumentKind = "article" | "post_file" | "series" | "bookmark" | "support" | "verification";
export type UnitKind = "article" | "post" | "thread_post" | "reply" | "cta" | "prompt" | "quote" | "metadata";
export type ChunkKind =
  | "prose" | "list" | "example" | "instruction" | "prompt"
  | "cta" | "quote" | "fact_candidate" | "position_candidate";
export type FreshnessClass = "stable" | "periodic" | "volatile";

/** note frontmatter の抽出結果 */
export interface NoteFrontmatter {
  title?: string;
  date?: string;
  url?: string;
  guid?: string;
  status?: string;
}

/** 取込分類の結果（正本 §9） */
export interface Classification {
  itemClass: ItemClass;
  ingestionRole: IngestionRole;
  retrievalMode: RetrievalMode;
  isAuthorVoice: boolean;
  publicationStatus: PublicationStatus;
  visibility: Visibility;
  reason: string;
}

export interface ParsedChunk {
  ordinal: number;
  headingPath: string[];
  chunkKind: ChunkKind;
  text: string;
  startChar: number;
  endChar: number;
  tokenCount: number;
}

export interface ParsedUnit {
  unitKind: UnitKind;
  ordinal: number;
  title: string | null;
  body: string;
  speaker: Speaker;
  isAuthorVoice: boolean;
  retrievalMode: RetrievalMode;
  freshnessClass: FreshnessClass | null;
  chunks: ParsedChunk[];
}

export interface ParsedDoc {
  sourceType: SourceType;
  relativePath: string;
  externalId: string | null;   // note の guid / X は null
  canonicalUrl: string | null;
  title: string | null;
  rawText: string;
  normalizedText: string;
  publicationStatus: PublicationStatus;
  visibility: Visibility;
  documentKind: DocumentKind;
  isAuthorVoice: boolean;
  retrievalMode: RetrievalMode;
  units: ParsedUnit[];
}

/** 入力ファイル1件 */
export interface SourceFile {
  sourceType: SourceType;
  relativePath: string;
  content: string;
}
