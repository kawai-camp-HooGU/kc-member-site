// ============================================================
// GET /api/bot/knowledge/index-health — 索引の健康チェック（B-11）
//
//   ★ なぜ要るか
//     HNSW索引は pgvector 非対応環境で「作成をスキップして先へ進む」実装になっている
//     （migration_add_kawai_knowledge.sql の do $$ ... exception when others then ... $$）。
//     索引が無くても SQL は成功するので、誰も気づかないまま全走査で動き続ける。
//     件数が増えた時点で急にレイテンシが悪化し、原因の特定に時間を取られる。
//
//   ⚠️ 運営のみ。参照専用。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { requireOps, errorResponse } from "../../../../../lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = supabaseAdmin as unknown as SupabaseClient;

export interface IndexHealthRow {
  name: string;
  present: boolean;
  valid: boolean;
  note: string;
}

export async function GET(request: Request) {
  try {
    await requireOps(request);

    const { data, error } = await sb.rpc("ai_index_health");
    if (error) {
      // 関数が無い＝ migration_ai_search_v2.sql が未適用。
      // ここで 500 にすると画面が壊れるので、状態として返す。
      return NextResponse.json({
        available: false,
        reason: "索引チェックの関数がありません。migration_ai_search_v2.sql を適用してください。",
        rows: [],
      });
    }

    const rows = ((data as IndexHealthRow[] | null) ?? []).map((r) => ({
      name: String(r.name ?? ""),
      present: Boolean(r.present),
      valid: Boolean(r.valid),
      note: String(r.note ?? ""),
    }));

    return NextResponse.json({ available: true, rows });
  } catch (err) {
    return errorResponse(err);
  }
}
