// ============================================================
// ナレッジ同期（service_role 専用・フェーズB / 正本 §15）
//   ・fixture（note/x）と chat_bookmarks を knowledge_documents/units/chunks へ upsert。
//   ・chunk は OpenAI で埋め込み、knowledge_chunk_upsert（text→vector）で保存。
//   ・content_hash 不変ならスキップ。dry_run は件数集計のみ。
//   ⚠️ 実行には migration_add_kawai_knowledge.sql の適用 と OPENAI_API_KEY が必要。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../supabaseAdmin";
import { HttpError } from "../../authz";
import { embedText, toVectorLiteral } from "../../bot/embed";
import { parseSourceFile } from "./index";
import { loadFixtureSourceFiles } from "./fixtures";
import { buildDocumentRow, buildUnitRow } from "./rows";
import type { ParsedDoc, SourceType } from "./types";

const sb = supabaseAdmin as unknown as SupabaseClient;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

export type SyncMode = "full" | "dry_run";
export interface SyncResult {
  source: SourceType;
  mode: SyncMode;
  scanned: number;
  upserted: number;
  unchanged: number;
  chunks: number;
}

// ── マスタ参照 ────────────────────────────────────────────────
async function getPersonaId(): Promise<string> {
  const { data } = await sb.from("ai_personas").select("id").eq("slug", "kawai").maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new HttpError(500, "ai_personas(slug=kawai) が見つかりません。マイグレーションを適用してください。");
  return id;
}
async function getSourceId(personaId: string, sourceType: SourceType): Promise<number> {
  const { data } = await sb.from("knowledge_sources")
    .select("id").eq("persona_id", personaId).eq("source_type", sourceType).limit(1).maybeSingle();
  const id = (data as { id?: number } | null)?.id;
  if (!id) throw new HttpError(500, `knowledge_sources(${sourceType}) が見つかりません。`);
  return id;
}

// ── 同期実行の記録 ────────────────────────────────────────────
async function startRun(sourceId: number): Promise<number> {
  const { data } = await sb.from("knowledge_sync_runs")
    .insert({ source_id: sourceId, mode: "full", status: "running" }).select("id").single();
  return (data as { id: number }).id;
}
async function finishRun(runId: number, patch: Record<string, unknown>): Promise<void> {
  await sb.from("knowledge_sync_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId);
}

// ── chat_bookmarks → ParsedDoc ───────────────────────────────
interface BookmarkRow {
  id: number; genre: string | null; expected_question: string | null;
  keywords: string[] | null; formatted_reply: string | null; original_text: string | null;
}
async function loadBookmarkDocs(): Promise<{ doc: ParsedDoc; bookmarkId: number }[]> {
  const { data } = await sb.from("chat_bookmarks")
    .select("id, genre, expected_question, keywords, formatted_reply, original_text")
    .eq("ai_enabled", true).eq("is_deleted", false);
  const rows = (data as BookmarkRow[] | null) ?? [];
  return rows.map((b) => {
    const answer = (b.formatted_reply ?? "").trim() || (b.original_text ?? "").trim();
    const chunkText = [b.expected_question ?? "", answer].filter(Boolean).join("\n");
    const doc: ParsedDoc = {
      sourceType: "chat_bookmark",
      relativePath: `chat_bookmarks/${b.id}`,
      externalId: `bm:${b.id}`,
      canonicalUrl: null,
      title: b.expected_question ?? b.genre ?? null,
      rawText: b.original_text ?? "",
      normalizedText: answer,
      publicationStatus: "published",
      visibility: "public",
      documentKind: "bookmark",
      isAuthorVoice: false,
      retrievalMode: "answer_only",
      units: [{
        unitKind: "article", ordinal: 0, title: b.expected_question ?? null, body: answer,
        speaker: "system", isAuthorVoice: false, retrievalMode: "answer_only", freshnessClass: null,
        chunks: [{ ordinal: 0, headingPath: [], chunkKind: "prose", text: chunkText, startChar: 0, endChar: chunkText.length, tokenCount: Math.max(1, Math.ceil([...chunkText].length / 2)) }],
      }],
    };
    return { doc, bookmarkId: b.id };
  });
}

// ── 1文書の upsert（子を作り直す）────────────────────────────
async function upsertDoc(
  personaId: number | string, sourceId: number, doc: ParsedDoc, mode: SyncMode, bookmarkId: number | null,
): Promise<{ state: "unchanged" | "upserted"; chunks: number }> {
  const row = buildDocumentRow(String(personaId), sourceId, doc, bookmarkId);

  const { data: exData } = await sb.from("knowledge_documents")
    .select("id, content_hash").eq("source_id", sourceId).eq("external_id", row.external_id).maybeSingle();
  const ex = exData as { id: number; content_hash: string } | null;
  if (ex && ex.content_hash === row.content_hash) return { state: "unchanged", chunks: 0 };
  if (mode === "dry_run") {
    return { state: "upserted", chunks: doc.units.reduce((n, u) => n + u.chunks.length, 0) };
  }

  let docId: number;
  if (ex) {
    await sb.from("knowledge_documents").update(row).eq("id", ex.id);
    docId = ex.id;
    const { data: units } = await sb.from("knowledge_units").select("id").eq("document_id", docId);
    const unitIds = ((units as { id: number }[] | null) ?? []).map((u) => u.id);
    if (unitIds.length) await sb.from("knowledge_chunks").delete().in("unit_id", unitIds);
    await sb.from("knowledge_units").delete().eq("document_id", docId);
  } else {
    const { data: ins } = await sb.from("knowledge_documents").insert(row).select("id").single();
    docId = (ins as { id: number }).id;
  }

  let chunkCount = 0;
  for (const u of doc.units) {
    const { data: unitIns } = await sb.from("knowledge_units").insert(buildUnitRow(docId, u)).select("id").single();
    const unitId = (unitIns as { id: number }).id;
    for (const c of u.chunks) {
      const emb = c.text ? await embedText(c.text) : [];
      await sb.rpc("knowledge_chunk_upsert", {
        p_unit_id: unitId, p_ordinal: c.ordinal, p_heading: c.headingPath, p_kind: c.chunkKind,
        p_text: c.text, p_start: c.startChar, p_end: c.endChar, p_tokens: c.tokenCount,
        p_emb: toVectorLiteral(emb), p_model: EMBED_MODEL,
      });
      chunkCount++;
    }
  }
  return { state: "upserted", chunks: chunkCount };
}

// ── エントリ ──────────────────────────────────────────────────
export async function runKnowledgeSync(source: SourceType, mode: SyncMode): Promise<SyncResult> {
  const personaId = await getPersonaId();
  const sourceId = await getSourceId(personaId, source);
  const runId = mode === "full" ? await startRun(sourceId) : null;

  const docs: { doc: ParsedDoc; bookmarkId: number | null }[] =
    source === "chat_bookmark"
      ? (await loadBookmarkDocs()).map((x) => ({ doc: x.doc, bookmarkId: x.bookmarkId }))
      : (await loadFixtureSourceFiles(source)).map((f) => ({ doc: parseSourceFile(f), bookmarkId: null }));

  let upserted = 0, unchanged = 0, chunks = 0;
  try {
    for (const { doc, bookmarkId } of docs) {
      const r = await upsertDoc(personaId, sourceId, doc, mode, bookmarkId);
      if (r.state === "unchanged") unchanged++; else upserted++;
      chunks += r.chunks;
    }
  } catch (e) {
    if (runId) await finishRun(runId, { status: "failed", error_count: 1 });
    throw e;
  }

  if (runId) {
    await finishRun(runId, {
      status: "succeeded", scanned_count: docs.length,
      inserted_count: upserted, unchanged_count: unchanged,
    });
  }
  return { source, mode, scanned: docs.length, upserted, unchanged, chunks };
}
