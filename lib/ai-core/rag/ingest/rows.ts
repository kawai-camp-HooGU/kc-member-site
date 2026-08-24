// ⚠️ AI Core（Ph3）。PJ固有のテーブルをここから参照しないこと。
// ============================================================
// ParsedDoc → DB 行への変換（純粋・サーバー安全）
//   ・knowledge_documents / knowledge_units の行を組み立てる。
//   ・chunk は埋め込みが要るため ingestServer 側で rpc に渡す。
// ============================================================
import { createHash } from "crypto";
import type { ParsedDoc, ParsedUnit } from "./types";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
/**
 * 文書の内容ハッシュ。
 *   ⚠️ 本文だけでなく「公開状態・公開範囲・期限」も混ぜる。
 *      本文が同じでも公開対象の属性が変われば取り込み直す必要があるため。
 *      （ここを本文だけにすると、非公開化や属性変更が索引に反映されない）
 */
export function docContentHash(doc: ParsedDoc): string {
  const meta = [
    doc.publicationStatus,
    doc.visibility,
    (doc.attrMode ?? "any"),
    [...(doc.targetAttrIds ?? [])].sort((a, b) => a - b).join(","),
    [...(doc.tags ?? [])].sort().join(","),
    doc.expiresAt ?? "",
    doc.title ?? "",
    doc.canonicalUrl ?? "",
  ].join("|");
  return sha256(`${meta}\n${doc.normalizedText}`);
}

export interface DocumentRow {
  persona_id: string;
  source_id: number;
  external_id: string | null;
  canonical_url: string | null;
  source_category: string | null;
  chat_bookmark_id: number | null;
  document_kind: string;
  title: string | null;
  raw_text: string;
  normalized_text: string;
  language: string;
  publication_status: string;
  visibility: string;
  retrieval_mode: string;
  is_author_voice: boolean;
  is_active: boolean;
  content_hash: string;
  /** 公開対象の属性ID（空＝全員）。R3 で追加。 */
  target_attr_ids: number[];
  /** any / all / exany / exall。R3 で追加。 */
  attr_mode: string;
  tags: string[];
  /** 期限切れは検索対象から外れる。null は無期限。 */
  expires_at: string | null;
  published_at: string | null;
}

export function buildDocumentRow(
  personaId: string, sourceId: number, doc: ParsedDoc, chatBookmarkId: number | null = null,
): DocumentRow {
  return {
    persona_id: personaId,
    source_id: sourceId,
    external_id: doc.externalId ?? doc.relativePath,
    canonical_url: doc.canonicalUrl,
    source_category: null,
    chat_bookmark_id: chatBookmarkId,
    document_kind: doc.documentKind,
    title: doc.title,
    raw_text: doc.rawText,
    normalized_text: doc.normalizedText,
    language: "ja",
    publication_status: doc.publicationStatus,
    visibility: doc.visibility,
    retrieval_mode: doc.retrievalMode,
    is_author_voice: doc.isAuthorVoice,
    is_active: true,
    content_hash: docContentHash(doc),
    target_attr_ids: doc.targetAttrIds ?? [],
    attr_mode: doc.attrMode ?? "any",
    tags: doc.tags ?? [],
    expires_at: doc.expiresAt ?? null,
    published_at: doc.publishedAt ?? null,
  };
}

export interface UnitRow {
  document_id: number;
  parent_unit_id: number | null;
  unit_kind: string;
  ordinal: number;
  title: string | null;
  body: string;
  speaker: string;
  is_author_voice: boolean;
  retrieval_mode: string;
  answer_weight: number;
  style_weight: number;
  content_hash: string;
  /** stable / periodic / volatile。volatile は回答に鮮度注意を添える（B-12）。 */
  freshness_class: string | null;
}

export function buildUnitRow(documentId: number, u: ParsedUnit): UnitRow {
  return {
    document_id: documentId,
    parent_unit_id: null,
    unit_kind: u.unitKind,
    ordinal: u.ordinal,
    title: u.title,
    body: u.body,
    speaker: u.speaker,
    is_author_voice: u.isAuthorVoice,
    retrieval_mode: u.retrievalMode,
    answer_weight: 1.0,
    style_weight: 1.0,
    content_hash: sha256(u.body),
    freshness_class: u.freshnessClass ?? null,
  };
}
