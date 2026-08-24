// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// KAWAI ナレッジ取込：共有型（フェーズB / 正本 database-spec.md 準拠）
//   ・ファイル → 文書(document) → 発言単位(unit) → 検索断片(chunk) の中間表現。
//   ・ここは純粋な変換ロジック用の型。DB upsert は ingest（B-3）で行う。
// ============================================================

// content / news は R3（Ph2）で追加。会員ポータルの資料・お知らせを取り込む。
export type SourceType = "note" | "x" | "chat_bookmark" | "content" | "news";

export type ItemClass = "primary_text" | "support_text" | "verification" | "media" | "other";
export type IngestionRole = "canonical" | "support" | "evidence" | "asset" | "excluded" | "needs_review";
export type RetrievalMode =
  | "answer_and_style" | "answer_only" | "style_only"
  | "evidence_only" | "paraphrase_only" | "excluded";
export type PublicationStatus = "published" | "draft" | "unknown" | "archived";
/** member = 会員限定（target_attr_ids / attrMode で絞る）。R3 で追加。 */
export type Visibility = "public" | "paid" | "mixed" | "internal" | "unknown" | "member";
export type Speaker = "kawai" | "external" | "system" | "unknown";
export type DocumentKind = "article" | "post_file" | "series" | "bookmark" | "support" | "verification";
export type UnitKind = "article" | "post" | "thread_post" | "reply" | "cta" | "prompt" | "quote" | "metadata";
export type ChunkKind =
  | "prose" | "list" | "example" | "instruction" | "prompt"
  | "cta" | "quote" | "fact_candidate" | "position_candidate";
export type FreshnessClass = "stable" | "periodic" | "volatile";
/** 属性による公開条件。lib/models.ts の PublishMode と同じ値。 */
export type AttrMode = "any" | "all" | "exany" | "exall";

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
  /** 公開対象の属性ID。空なら全員。contents / news の設定をそのまま写す。 */
  targetAttrIds?: number[];
  /** 公開条件。既定は any。 */
  attrMode?: AttrMode;
  /** 分類タグ（現状は未使用。将来の絞り込み用に器だけ持つ）。 */
  tags?: string[];
  /** この日時を過ぎたら検索対象から外す。null / 未指定は無期限。 */
  expiresAt?: string | null;
  /** 鮮度スコア用の公開日。 */
  publishedAt?: string | null;
}

/** 入力ファイル1件 */
export interface SourceFile {
  sourceType: SourceType;
  relativePath: string;
  content: string;
}
