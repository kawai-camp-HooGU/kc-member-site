// ============================================================
// LINE流入経路の付与（POST・公開・Phase 6）
//   LIFF入口（?s=経路キー）から userId＋経路キーを受け、
//   友だちに source_id を付与し、経路アクション（属性など）を発火する。
//   ・本人特定は IDトークン検証（ログインチャネルID設定時）。未設定は userId 信頼。
//   ・書き込みのみ・低リスク。存在しない経路は無視（ok:false）して本流は止めない。
// ============================================================
import { NextResponse } from "next/server";
import { attachFriendSource } from "../../../../lib/lineLiffServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body { accountId?: number; userId?: string; idToken?: string; sourceKey?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const b = (await request.json()) as Body;
    if (b.accountId == null) return NextResponse.json({ error: "accountId は必須です" }, { status: 400 });
    if (!b.sourceKey) return NextResponse.json({ error: "sourceKey は必須です" }, { status: 400 });
    const r = await attachFriendSource(b.accountId, b.userId ?? "", b.sourceKey, b.idToken);
    // 経路が無効でも 200（本流を止めない）。結果は ok で伝える。
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
