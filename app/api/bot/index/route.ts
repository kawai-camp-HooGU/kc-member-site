// ============================================================
// POST /api/bot/index — ブックマーク索引の再構築（管理・★凍結）
//   ・運営(requireOps)のみ。
//   ・chat_bookmarks(ai_enabled=true) → bot_bm_index を再生成する。
//
//   ⚠️ R4（フェーズB一本化）で凍結した。
//      通常運転では 409 を返す。切り戻し中（AI_PHASE_A_FALLBACK=true）だけ動く。
//      索引そのもの（bot_bm_index）は drop していない。3か月後に削除を判断する。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { rebuildBotIndex } from "../../../../lib/bot/botServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireOps(request);
    if (process.env.AI_PHASE_A_FALLBACK !== "true") {
      throw new HttpError(409,
        "旧索引（フェーズA）は一本化により凍結しています。切り戻し中のみ再構築できます。" +
        "通常のナレッジ更新は「ナレッジ同期」から行ってください。");
    }
    const result = await rebuildBotIndex();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
