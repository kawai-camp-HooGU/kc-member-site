// ============================================================
// POST /api/bot/index — ブックマーク索引の再構築（管理）
//   ・運営(requireOps)のみ。
//   ・chat_bookmarks(ai_enabled=true) → bot_bm_index を再生成する。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse } from "../../../../lib/authz";
import { rebuildBotIndex } from "../../../../lib/bot/botServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireOps(request);
    const result = await rebuildBotIndex();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
