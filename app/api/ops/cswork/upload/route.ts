// ============================================================
// POST /api/ops/cswork/upload  … md / CSV を差し替える（REQ-028）
//
//   body: { kind: "ops"|"design"|"watchlist", filename: string, content: string,
//           activate?: boolean }
//
//   検証（lib/csWork/build.ts の validate）に1件でも ng があれば
//   **現行版を切り替えない**。アップロード自体は履歴として残す。
//
//   ⚠️ md/CSV はテキストのまま JSON で受け取る（multipart にしない）。
//      apiFetch がそのまま使えるため、クライアント側の実装が単純になる。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../../lib/authz";
import { parseFrontMatter } from "../../../../../lib/csWork/parse";
import { validate } from "../../../../../lib/csWork/build";
import { saveDoc, audit, type CsWorkKind } from "../../../../../lib/csWork/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const KINDS: CsWorkKind[] = ["ops", "design", "watchlist"];

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = await request.json().catch(() => null) as
      { kind?: string; filename?: string; content?: string; activate?: boolean } | null;

    const kind = (body?.kind ?? "") as CsWorkKind;
    const content = body?.content ?? "";
    const filename = (body?.filename ?? "").slice(0, 120);

    if (!KINDS.includes(kind)) throw new HttpError(400, "種別が不正です");
    if (!content.trim()) throw new HttpError(400, "ファイルの中身が空です");
    if (content.length > MAX_BYTES) throw new HttpError(413, "ファイルが大きすぎます（5MBまで）");

    const result = validate(kind, content);
    const meta = kind === "watchlist" ? {} : parseFrontMatter(content).meta;

    const row = await saveDoc({
      kind,
      filename,
      text: content,
      title: String(meta.title ?? filename ?? ""),
      version: String(meta.version ?? ""),
      meta: { ...meta, validation: result.summary },
      memberId: me.memberId,
      // 検証NGなら現行版にしない（表示は直前の現行版のまま）
      makeCurrent: result.ok && body?.activate !== false,
    });

    await audit("upload", me.memberId, row.id, {
      kind, filename, ok: result.ok, bytes: content.length,
    });

    return NextResponse.json({
      ok: result.ok,
      activated: row.is_current,
      doc: row,
      validation: result.summary,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
