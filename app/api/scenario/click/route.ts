import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fireEvent, resolveLinkActions } from "../../../../lib/actionsServer";

// シナリオ計測リンク：クリックを記録して元URLへリダイレクト。
//   /api/scenario/click?l=<linkId>&m=<memberId>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const linkId = Number(searchParams.get("l"));
  const memberId = searchParams.get("m") ? Number(searchParams.get("m")) : null;
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || "/";

  if (!linkId) return NextResponse.redirect(fallback);
  const { data: link } = await supabaseAdmin.from("scenario_links").select("url").eq("id", linkId).maybeSingle();
  if (!link) return NextResponse.redirect(fallback);
  try { await supabaseAdmin.from("scenario_clicks").insert({ link_id: linkId, member_id: memberId }); } catch { /* noop */ }

  // 属性の自動更新（このURLに設定されたアクションを実行）
  if (memberId) {
    const actions = await resolveLinkActions("scenario", linkId);
    await fireEvent({ trigger: "link_click", memberId, refKey: `link:s:${linkId}`, actions });
  }
  return NextResponse.redirect(link.url);
}
