// ============================================================
// POST /api/bot/knowledge/sync — ナレッジ同期（管理・フェーズB）
//   ・運営(requireOps)のみ。
//   ・body: { source: 'note'|'x'|'chat_bookmark', mode?: 'full'|'dry_run' }
//   ・fixture / chat_bookmarks を knowledge_* へ upsert（chunk は埋め込み）。
//   ⚠️ migration_add_kawai_knowledge.sql 適用 と OPENAI_API_KEY が前提。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../../lib/authz";
import { runKnowledgeSync, type SyncMode } from "../../../../../lib/ai/knowledge/ingestServer";
import type { SourceType } from "../../../../../lib/ai/knowledge/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SOURCES: SourceType[] = ["note", "x", "chat_bookmark"];
const MODES: SyncMode[] = ["full", "dry_run"];

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const body = (await request.json().catch(() => ({}))) as { source?: string; mode?: string };
    const source = body.source as SourceType | undefined;
    const mode = (body.mode as SyncMode | undefined) ?? "full";
    if (!source || !SOURCES.includes(source)) {
      throw new HttpError(400, "source は note / x / chat_bookmark のいずれかを指定してください。");
    }
    if (!MODES.includes(mode)) throw new HttpError(400, "mode は full / dry_run のいずれかです。");

    const result = await runKnowledgeSync(source, mode);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
