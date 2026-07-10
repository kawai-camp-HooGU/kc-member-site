import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// 計測リンク：クリックを記録して元URLへリダイレクトする。
//   /api/broadcast/click?l=<linkId>&m=<memberId>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const linkId = Number(searchParams.get("l"));
  const memberId = searchParams.get("m") ? Number(searchParams.get("m")) : null;

  if (!linkId) return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL || "/");

  const { data: link } = await supabaseAdmin.from("broadcast_links").select("url").eq("id", linkId).maybeSingle();
  if (!link) return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL || "/");

  // クリックを記録（失敗してもリダイレクトは行う）
  try {
    await supabaseAdmin.from("broadcast_clicks").insert({ link_id: linkId, member_id: memberId });
  } catch { /* noop */ }

  return NextResponse.redirect(link.url);
}
