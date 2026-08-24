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
import { embedTexts, toVectorLiteral } from "../../bot/embed";
import { parseSourceFile } from "./index";
import { loadFixtureSourceFiles } from "./fixtures";
import { loadContentDocs, loadNewsDocs } from "./portalDocs";
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
  /** 元が消えた／非公開になったため検索対象から外した文書の件数 */
  deactivated: number;
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
      retrievalMode: "answer_only",   // 文体は真似ない。回答の材料としてだけ使う
      // ジャンルをタグへ写す。将来ジャンルで検索を絞るときの手がかりになる（現状は絞っていない）
      tags: b.genre ? [`genre:${b.genre}`] : [],
      targetAttrIds: [],              // ブックマークは全員向け（取り込み仕様 決定3）
      attrMode: "any",
      units: [{
        unitKind: "article", ordinal: 0, title: b.expected_question ?? null, body: answer,
        speaker: "system", isAuthorVoice: false, retrievalMode: "answer_only", freshnessClass: null,
        chunks: [{ ordinal: 0, headingPath: [], chunkKind: "prose", text: chunkText, startChar: 0, endChar: chunkText.length, tokenCount: Math.max(1, Math.ceil([...chunkText].length / 2)) }],
      }],
    };
    return { doc, bookmarkId: b.id };
  });
}

// ── 1文書の upsert（B-8：作り直さず、その場で更新する）──────
//
//   ★ 以前は unit / chunk を delete → insert していた。2つ問題があった。
//     ① chunk_id が毎回変わる。ai_traces.retrieval_json に残した採点根拠が
//        存在しないIDを指すことになり、あとから根拠をたどれない
//     ② persona_facts.source_chunk_id が on delete restrict のため、
//        事実が1件でも紐づいた時点で delete が失敗し、同期そのものが止まる
//        （いま persona_facts が空なので表面化していないだけ）
//
//   そこで (document_id, ordinal, unit_kind) と (unit_id, ordinal) の
//   一意制約を使って上書きし、余った分だけを消す。IDは動かない。
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
  } else {
    const { data: ins } = await sb.from("knowledge_documents").insert(row).select("id").single();
    docId = (ins as { id: number }).id;
  }

  // ── いまDBにある chunk の本文を控える（変わっていない断片は埋め込み直さない）──
  //   埋め込みは有料。本文が同じなら取り直す意味がない。
  //   キーは「unitのordinal:unit_kind|chunkのordinal」。IDに依存させない。
  const existingText = new Map<string, string>();
  if (ex) {
    const { data: cur } = await sb.from("knowledge_units")
      .select("id, ordinal, unit_kind, knowledge_chunks(ordinal, text)")
      .eq("document_id", docId);
    for (const u of (cur as {
      ordinal: number; unit_kind: string;
      knowledge_chunks?: { ordinal: number; text: string | null }[];
    }[] | null) ?? []) {
      for (const c of u.knowledge_chunks ?? []) {
        existingText.set(`${u.ordinal}:${u.unit_kind}|${c.ordinal}`, c.text ?? "");
      }
    }
  }

  // ── 埋め込みは「本文が変わった断片」だけまとめて取る ──
  const allChunks = doc.units.flatMap((u) =>
    u.chunks.map((c) => ({ key: `${u.ordinal}:${u.unitKind}|${c.ordinal}`, text: c.text })));
  const needEmbed = allChunks.filter((c) => existingText.get(c.key) !== c.text);
  const embedded = needEmbed.length ? await embedTexts(needEmbed.map((c) => c.text)) : [];
  const embOf = new Map<string, number[]>();
  needEmbed.forEach((c, i) => embOf.set(c.key, embedded[i] ?? []));

  // ── unit / chunk を上書き（IDは動かない）──
  const keptUnitIds: number[] = [];
  let chunkCount = 0;

  for (const u of doc.units) {
    const { data: unitRow } = await sb.from("knowledge_units")
      .upsert(buildUnitRow(docId, u), { onConflict: "document_id,ordinal,unit_kind" })
      .select("id").single();
    const unitId = (unitRow as { id: number }).id;
    keptUnitIds.push(unitId);

    for (const c of u.chunks) {
      const key = `${u.ordinal}:${u.unitKind}|${c.ordinal}`;
      // 本文が変わっていない断片は、いまの埋め込みをそのまま使う（空を渡すと消えるため注意）
      const emb = embOf.get(key);
      await sb.rpc("knowledge_chunk_upsert", {
        p_unit_id: unitId, p_ordinal: c.ordinal, p_heading: c.headingPath, p_kind: c.chunkKind,
        p_text: c.text, p_start: c.startChar, p_end: c.endChar, p_tokens: c.tokenCount,
        // 変わっていなければ null を渡し、SQL側で既存の埋め込みを保つ
        p_emb: emb ? toVectorLiteral(emb) : null, p_model: EMBED_MODEL,
      });
      chunkCount++;
    }

    // この unit で余った chunk（文書が短くなった分）を消す
    await pruneChunks(unitId, u.chunks.length);
  }

  // 余った unit（unit数が減った分）を消す
  await pruneUnits(docId, keptUnitIds);

  return { state: "upserted", chunks: chunkCount };
}

/**
 * 使われなくなった chunk を消す。
 * ⚠️ persona_facts.source_chunk_id が on delete restrict のため、
 *    事実が紐づいた chunk は消せない。失敗しても同期は止めない（残るだけ）。
 */
async function pruneChunks(unitId: number, keep: number): Promise<void> {
  try {
    await sb.from("knowledge_chunks").delete().eq("unit_id", unitId).gte("ordinal", keep);
  } catch {
    // 参照されている断片は残す（develop.md §9：本処理を止めない）
  }
}

/** 使われなくなった unit を消す。子の chunk を先に消す（on delete restrict のため）。 */
async function pruneUnits(docId: number, keptUnitIds: number[]): Promise<void> {
  try {
    const { data } = await sb.from("knowledge_units").select("id").eq("document_id", docId);
    const stale = ((data as { id: number }[] | null) ?? [])
      .map((u) => u.id).filter((id) => !keptUnitIds.includes(id));
    if (stale.length === 0) return;
    await sb.from("knowledge_chunks").delete().in("unit_id", stale);
    await sb.from("knowledge_units").delete().in("id", stale);
  } catch {
    // 参照されている単位は残す
  }
}

// ── 取り込み元ごとの読み込み ─────────────────────────────────
async function loadDocs(source: SourceType): Promise<{ doc: ParsedDoc; bookmarkId: number | null }[]> {
  if (source === "chat_bookmark") {
    return (await loadBookmarkDocs()).map((x) => ({ doc: x.doc, bookmarkId: x.bookmarkId }));
  }
  if (source === "content") {
    return (await loadContentDocs()).map((doc) => ({ doc, bookmarkId: null }));
  }
  if (source === "news") {
    return (await loadNewsDocs()).map((doc) => ({ doc, bookmarkId: null }));
  }
  // note / x はファイル（fixture）から
  return (await loadFixtureSourceFiles(source)).map((f) => ({ doc: parseSourceFile(f), bookmarkId: null }));
}

/** 索引更新（cron）で回す取り込み元。ファイル由来の note / x は含めない。 */
export const AUTO_SYNC_SOURCES: SourceType[] = ["content", "news", "chat_bookmark"];

// ── 消えた文書を検索対象から外す ─────────────────────────────
//   ★ 情報漏えい防止の要。資料を非公開にした・削除した・属性を絞った場合、
//     取り込み済みの文書が索引に残り続けるとAIが引き続き参照してしまう。
//     取り込みのたびに「今回読めた external_id」に無いものを is_active=false にする。
//   ※ 行そのものは消さない（トレースから当時の根拠をたどれるようにするため）。
async function deactivateMissing(
  sourceId: number, docs: ParsedDoc[], mode: SyncMode,
): Promise<number> {
  if (mode === "dry_run") return 0;
  const alive = docs.map((d) => d.externalId ?? d.relativePath).filter(Boolean) as string[];

  const { data } = await sb.from("knowledge_documents")
    .select("id, external_id").eq("source_id", sourceId).eq("is_active", true);
  const rows = (data as { id: number; external_id: string | null }[] | null) ?? [];
  const gone = rows.filter((r) => !r.external_id || !alive.includes(r.external_id)).map((r) => r.id);
  if (!gone.length) return 0;

  await sb.from("knowledge_documents").update({ is_active: false }).in("id", gone);
  return gone.length;
}

// ── エントリ ──────────────────────────────────────────────────
export async function runKnowledgeSync(source: SourceType, mode: SyncMode): Promise<SyncResult> {
  const personaId = await getPersonaId();
  const sourceId = await getSourceId(personaId, source);
  const runId = mode === "full" ? await startRun(sourceId) : null;

  const docs: { doc: ParsedDoc; bookmarkId: number | null }[] = await loadDocs(source);

  let upserted = 0, unchanged = 0, chunks = 0, deactivated = 0;
  try {
    for (const { doc, bookmarkId } of docs) {
      const r = await upsertDoc(personaId, sourceId, doc, mode, bookmarkId);
      if (r.state === "unchanged") unchanged++; else upserted++;
      chunks += r.chunks;
    }
    deactivated = await deactivateMissing(sourceId, docs.map((d) => d.doc), mode);
  } catch (e) {
    if (runId) await finishRun(runId, { status: "failed", error_count: 1 });
    throw e;
  }

  if (runId) {
    await finishRun(runId, {
      status: "succeeded", scanned_count: docs.length,
      inserted_count: upserted, unchanged_count: unchanged, excluded_count: deactivated,
    });
  }
  return { source, mode, scanned: docs.length, upserted, unchanged, chunks, deactivated };
}
