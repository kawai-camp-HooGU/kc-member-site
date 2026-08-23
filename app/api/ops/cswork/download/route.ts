// ============================================================
// GET /api/ops/cswork/download  … 現行版 or テンプレートを取り出す（REQ-028）
//
//   ?kind=ops|design|watchlist
//   ?what=current … いま画面に出ている現行版そのもの（再編集して上げ直す用）
//   ?what=template … 書式のひな形（何も登録されていなくても取れる）
//
//   ⚠️ 本文はテキストのまま JSON で返す。ブラウザ側で Blob にして保存する。
//      直リンクにしないのは、この API が Authorization ヘッダ必須のため
//      （<a href> では Bearer トークンを付けられない）。
//   ⚠️ 現行版の md には運用設定値のパスワードが**平文で**入っている。
//      画面表示は伏字なのに、ダウンロードだと素通しになってしまうため、
//      what=current は管理者のみに絞る（テンプレートは運営なら誰でも可）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireAdmin, errorResponse, HttpError } from "../../../../../lib/authz";
import { readCurrentContent, audit, type CsWorkKind } from "../../../../../lib/csWork/server";
import { templateFor } from "../../../../../lib/csWork/templates";

export const dynamic = "force-dynamic";

const KINDS: CsWorkKind[] = ["ops", "design", "watchlist"];

export async function GET(request: Request) {
  try {
    const me = await requireOps(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as CsWorkKind | null;
    const what = url.searchParams.get("what") ?? "current";

    if (!kind || !KINDS.includes(kind)) throw new HttpError(400, "種別が不正です");

    if (what === "template") {
      const t = templateFor(kind);
      return NextResponse.json(t, { headers: { "Cache-Control": "no-store" } });
    }

    // 現行版は認証情報を含むため管理者のみ
    await requireAdmin(request);

    const cur = await readCurrentContent(kind);
    if (!cur) throw new HttpError(404, "まだ登録されていません");

    await audit("download", me.memberId, cur.row.id, { kind, filename: cur.row.filename });

    return NextResponse.json({
      filename: cur.row.filename || `${kind}.${kind === "watchlist" ? "csv" : "md"}`,
      content: cur.text,
      version: cur.row.version ?? "",
      uploadedAt: cur.row.uploaded_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
