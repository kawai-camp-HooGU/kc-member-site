// ============================================================
// LIFF設定の取得（GET ?acc=<accountId>・公開）
//   LIFFページが liff.init するための LIFF ID（公開値）を返す。
// ============================================================
import { NextResponse } from "next/server";
import { getLiffConfig } from "../../../../lib/lineLiffServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const acc = Number(searchParams.get("acc"));
    if (!Number.isFinite(acc)) return NextResponse.json({ error: "acc が不正です" }, { status: 400 });
    const cfg = await getLiffConfig(acc);
    if (!cfg) return NextResponse.json({ error: "LIFFが設定されていません" }, { status: 404 });
    return NextResponse.json(cfg);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
