// ============================================================
// GET /api/bot/knowledge/status — ナレッジ取り込み状況（管理）
//   ・運営(requireOps)のみ。
//   ・入口ごとの 文書数・チャンク数・検索対象数・埋め込み済み数・最終同期 を返す。
//   ・SQL関数 knowledge_status() が未適用でも画面を壊さない（空配列 ＋ 理由を返す）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { requireOps, errorResponse } from "../../../../../lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = supabaseAdmin as unknown as SupabaseClient;

/** 自動更新の対象（/api/cron/ai-index が回す入口） */
const AUTO = new Set(["content", "news", "chat_bookmark"]);

interface Row {
  source_type: string;
  authority: number | null;
  documents: number;
  inactive: number;
  chunks: number;
  retrievable: number;
  embedded: number;
  last_synced_at: string | null;
  last_status: string | null;
}

export async function GET(request: Request) {
  try {
    await requireOps(request);

    const { data: p } = await sb.from("ai_personas").select("id").eq("slug", "kawai").maybeSingle();
    const personaId = (p as { id?: string } | null)?.id ?? null;

    const { data, error } = await sb.rpc("knowledge_status", { p_persona_id: personaId });
    if (error) {
      // 未適用でも画面は開けるようにする（develop.md §9：失敗時は本処理を止めない）
      return NextResponse.json({
        rows: [],
        unavailable: "取り込み状況を取得できませんでした。migration_knowledge_status.sql を適用してください。",
      });
    }

    const rows = ((data as Row[] | null) ?? []).map((r) => ({
      sourceType: r.source_type,
      authority: r.authority ?? null,
      documents: r.documents ?? 0,
      inactive: r.inactive ?? 0,
      chunks: r.chunks ?? 0,
      retrievable: r.retrievable ?? 0,
      embedded: r.embedded ?? 0,
      lastSyncedAt: r.last_synced_at,
      lastStatus: r.last_status,
      auto: AUTO.has(r.source_type),
    }));

    return NextResponse.json({ rows, cronEnabled: process.env.AI_INDEX_CRON_ENABLED === "true" });
  } catch (err) {
    return errorResponse(err);
  }
}
