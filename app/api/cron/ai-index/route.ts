// ============================================================
// ナレッジ索引の定期更新（Vercel Cron）
//   GET /api/cron/ai-index → { ran, results }
//   ・contents / news / chat_bookmarks の変更を knowledge_* へ反映する。
//   ・content_hash が同じ文書はスキップするので、通常は数秒で終わる。
//   ・元が非公開・削除・属性変更になった文書は is_active=false にして検索から外す。
//   ⚠️ fail-closed：CRON_SECRET 未設定なら誰も叩けない（requireCron）。
//   ⚠️ 1つの取り込み元が失敗しても他は続ける（develop.md §9：失敗時は本処理を止めない）。
//   ※ note / x はファイル（fixture）由来のため自動対象に含めない。
//      手動同期は POST /api/bot/knowledge/sync から。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse } from "../../../../lib/authz";
import { runKnowledgeSync, AUTO_SYNC_SOURCES } from "../../../../lib/ai/knowledge/ingestServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Outcome {
  source: string;
  ok: boolean;
  scanned?: number;
  upserted?: number;
  unchanged?: number;
  chunks?: number;
  deactivated?: number;
  error?: string;
}

export async function GET(request: Request) {
  try {
    requireCron(request);

    // 索引更新そのものを止めているとき（初回取り込み前など）は何もしない
    if (process.env.AI_INDEX_CRON_ENABLED !== "true") {
      return NextResponse.json({
        ran: new Date().toISOString(),
        skipped: "AI_INDEX_CRON_ENABLED が true ではありません",
        results: [],
      });
    }

    const results: Outcome[] = [];
    for (const source of AUTO_SYNC_SOURCES) {
      try {
        const r = await runKnowledgeSync(source, "full");
        results.push({
          source, ok: true,
          scanned: r.scanned, upserted: r.upserted, unchanged: r.unchanged,
          chunks: r.chunks, deactivated: r.deactivated,
        });
      } catch (e) {
        // 1つ落ちても残りは回す。詳細は knowledge_sync_runs に status=failed で残る。
        results.push({
          source, ok: false,
          error: e instanceof Error ? e.message : "同期に失敗しました",
        });
      }
    }

    return NextResponse.json({ ran: new Date().toISOString(), results });
  } catch (err) {
    return errorResponse(err);
  }
}
