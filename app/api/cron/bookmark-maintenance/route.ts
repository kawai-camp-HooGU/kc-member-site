// ============================================================
// ブックマーク（ナレッジ）の日次メンテナンス（Vercel Cron）
//   GET /api/cron/bookmark-maintenance → { ran, expired }
//
//   ・有効期限（valid_until）を過ぎた承認済みブックマークを archived にする。
//     索引側は取り込み条件（review_status='approved'）で自動的に外れる。
//   ⚠️ 削除はしない。履歴として残し、運営が一覧で見直せるようにする
//      （develop.md §2-2 の論理削除方針）。
//   ⚠️ 参照実績（used_count / last_used_at）はここでは触らない。
//      検索で採用された瞬間に lib/ai/context.ts の markBookmarksUsed() が加算する。
//      ai_traces は既定90日で消えるため、後追い集計にしていない。
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireCron, errorResponse } from "../../../../lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = supabaseAdmin as unknown as SupabaseClient;

export async function GET(request: Request) {
  try {
    requireCron(request);

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await sb.from("chat_bookmarks")
      .update({ review_status: "archived" })
      .eq("review_status", "approved")
      .eq("is_deleted", false)
      .not("valid_until", "is", null)
      .lt("valid_until", today)
      .select("id");
    if (error) throw error;

    const expired = ((data as { id: number }[] | null) ?? []).map((r) => r.id);
    if (expired.length > 0) {
      console.warn(`bookmark-maintenance: 期限切れ ${expired.length} 件を archived にしました`, expired);
    }
    return NextResponse.json({ ran: new Date().toISOString(), expired: expired.length, ids: expired });
  } catch (err) {
    return errorResponse(err);
  }
}
