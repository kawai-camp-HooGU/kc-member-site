// ============================================================
// AIトレースの定期パージ（Vercel Cron・情報漏洩対策）
//   GET /api/cron/ai-purge → { ran, result }
//   ・ai_traces … 既定90日より古い行を物理削除（ai_feedback は cascade で消える）
//   ・ai_usage_minute … 1日より古い行を削除（レート判定用の一時カウンタ）
//   ・ai_consult_sessions … 既定90日より古い相談セッション（turns は cascade で消える／A-3）
//   ・bot_sessions … 既定90日より古い会話（bot_messages は cascade で消える／S-5）
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireCron, errorResponse } from "../../../../lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sb = supabaseAdmin as unknown as SupabaseClient;

export async function GET(request: Request) {
  try {
    requireCron(request);

    const days = Number(process.env.AI_TRACE_RETENTION_DAYS ?? 90);
    const traceCutoff = new Date(Date.now() - days * 864e5).toISOString();
    const minuteCutoff = new Date(Date.now() - 864e5).toISOString();

    const { count: traces } = await sb
      .from("ai_traces").delete({ count: "exact" }).lt("created_at", traceCutoff);
    const { count: minutes } = await sb
      .from("ai_usage_minute").delete({ count: "exact" }).lt("minute_at", minuteCutoff);

    // ②返信提案の相談セッション（A-3）。テーブル未適用でも他の掃除は止めない。
    let consults = 0;
    try {
      const { count } = await sb
        .from("ai_consult_sessions").delete({ count: "exact" }).lt("last_at", traceCutoff);
      consults = count ?? 0;
    } catch {
      consults = 0;
    }

    // 公開ボットの会話（S-5）。テーブル未適用でも他の掃除は止めない。
    let botSessions = 0;
    try {
      const { count } = await sb
        .from("bot_sessions").delete({ count: "exact" }).lt("last_at", traceCutoff);
      botSessions = count ?? 0;
    } catch {
      botSessions = 0;
    }

    return NextResponse.json({
      ran: new Date().toISOString(),
      result: {
        retentionDays: days,
        tracesDeleted: traces ?? 0,
        usageMinutesDeleted: minutes ?? 0,
        consultSessionsDeleted: consults,
        botSessionsDeleted: botSessions,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
