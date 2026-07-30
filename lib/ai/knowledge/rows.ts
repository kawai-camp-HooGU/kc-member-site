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
export function docContentHash(doc: ParsedDoc): string {
  return sha256(doc.normalizedText);
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
  };
}
