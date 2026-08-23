// ============================================================
// GET  /api/ops/cswork/history?kind=ops  … 版の履歴を返す（REQ-028）
// POST /api/ops/cswork/history           … 指定の版を現行版にする（復元）
//        body: { id: string }
//
//   ⚠️ 復元は表示を丸ごと差し替える操作なので、監査ログに必ず残す。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../../lib/authz";
import { fetchHistory, activateDoc, audit, type CsWorkKind } from "../../../../../lib/csWork/server";

export const dynamic = "force-dynamic";

const KINDS: CsWorkKind[] = ["ops", "design", "watchlist"];

export async function GET(request: Request) {
  try {
    await requireOps(request);
    const kind = new URL(request.url).searchParams.get("kind") as CsWorkKind | null;
    if (!kind || !KINDS.includes(kind)) throw new HttpError(400, "種別が不正です");
    return NextResponse.json({ items: await fetchHistory(kind) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = await request.json().catch(() => null) as { id?: string } | null;
    if (!body?.id) throw new HttpError(400, "対象が指定されていません");

    const row = await activateDoc(body.id);
    await audit("activate", me.memberId, row.id, { kind: row.kind, version: row.version });
    return NextResponse.json({ ok: true, doc: row });
  } catch (err) {
    return errorResponse(err);
  }
}
