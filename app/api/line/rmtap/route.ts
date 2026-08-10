// ============================================================
// リッチメニュー タップ計測（GET・公開・P2）
//   /api/line/rmtap?m=<menuId>&i=<cellIndex>
//   タップを記録し、そのセルの本来の遷移先（URL / LIFF）へリダイレクトする。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Cell { actionType?: string; actionValue?: string }

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || "/";
  const menuId = Number(searchParams.get("m"));
  const idx = Number(searchParams.get("i"));
  if (!Number.isFinite(menuId) || !Number.isFinite(idx)) return NextResponse.redirect(fallback);

  const { data: menu } = await supabaseAdmin
    .from("line_rich_menus").select("cells, account_id, is_deleted").eq("id", menuId).maybeSingle();
  if (!menu || menu.is_deleted) return NextResponse.redirect(fallback);

  // タップ記録（失敗してもリダイレクトは行う）
  try { await supabaseAdmin.from("line_rich_menu_taps").insert({ menu_id: menuId, cell_index: idx }); } catch { /* noop */ }

  // 遷移先の解決
  const cells = (Array.isArray(menu.cells) ? menu.cells : []) as unknown as Cell[];
  const cell = cells[idx];
  let dest = fallback;
  if (cell) {
    if (cell.actionType === "uri" && cell.actionValue?.trim()) {
      dest = cell.actionValue.trim();
    } else if (cell.actionType === "liff" || cell.actionType === "liff_mypage") {
      const { data: acc } = await supabaseAdmin
        .from("line_accounts").select("liff_id").eq("id", menu.account_id).maybeSingle();
      const liffId = acc?.liff_id ?? "";
      if (liffId) dest = cell.actionType === "liff" ? `https://liff.line.me/${liffId}` : `https://liff.line.me/${liffId}/mypage`;
    }
  }
  return NextResponse.redirect(dest);
}
