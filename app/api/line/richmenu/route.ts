// ============================================================
// リッチメニュー管理（POST）：公開/既定設定/削除（運営のみ）
//   一覧・下書き保存はクライアントから RLS(運営) で直接 supabase（lib/lineRichMenu.ts）。
//   LINE API を叩く「公開・既定・削除」だけをサーバーで行う。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { publishRichMenu, setRichMenuDefault, deleteRichMenuRow } from "../../../../lib/lineRichMenuServer";

interface Body { action?: "publish" | "default" | "delete"; id?: number }

export async function POST(request: Request): Promise<Response> {
  try {
    await requireOps(request);
    const b = (await request.json()) as Body;
    if (b.id == null) throw new HttpError(400, "id は必須です");

    const run =
      b.action === "publish" ? publishRichMenu
      : b.action === "default" ? setRichMenuDefault
      : b.action === "delete" ? deleteRichMenuRow
      : null;
    if (!run) throw new HttpError(400, "action が不正です");

    const r = await run(b.id);
    if (!r.ok) throw new HttpError(409, r.error ?? "処理に失敗しました");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
