import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fireEvent, resolveLinkActions } from "../../../../lib/actionsServer";

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

  // 属性の自動更新（このURLに設定されたアクションを実行）。
  //   fireEvent は例外を投げない＝リダイレクトを妨げない。
  if (memberId) {
    const actions = await resolveLinkActions("broadcast", linkId);
    await fireEvent({ trigger: "link_click", memberId, refKey: `link:b:${linkId}`, actions });
  }

  return NextResponse.redirect(link.url);
}
