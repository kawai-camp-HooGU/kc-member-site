// ============================================================
// LINE内マイページのデータ取得（POST・公開・Phase 5c）
//   LIFFで取得した IDトークン（本人確認）＋userId から、
//   連携済み会員のプロフィールを返す。PII のため本人検証は必須。
// ============================================================
import { NextResponse } from "next/server";
import { getMyPage } from "../../../../lib/lineLiffServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body { accountId?: number; userId?: string; idToken?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const b = (await request.json()) as Body;
    if (b.accountId == null) return NextResponse.json({ error: "accountId は必須です" }, { status: 400 });
    const r = await getMyPage(b.accountId, b.userId, b.idToken);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "取得に失敗しました" }, { status: 400 });
    return NextResponse.json({ ok: true, data: r.data });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
