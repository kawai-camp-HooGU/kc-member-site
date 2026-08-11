import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fireEvent, resolveLinkActions } from "../../../../lib/actionsServer";
import { resolveUnsubscribe } from "../../../../lib/suppressionServer";

// 計測リンク：クリックを記録して元URLへリダイレクトする。
//   /api/broadcast/click?l=<linkId>&m=<memberId>&e=<b64url(email)>&s=<sig>
//   e/s（署名付きメアド）があれば、ポータル未登録のメアドでも集計に残す。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const linkId = Number(searchParams.get("l"));
  const mRaw = searchParams.get("m");
  let memberId = mRaw && Number(mRaw) > 0 ? Number(mRaw) : null;
  // メールアドレス指定配信：署名付きメアドを検証（改ざんは無視）
  const email = resolveUnsubscribe(searchParams.get("e"), searchParams.get("s"));

  if (!linkId) return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL || "/");

  const { data: link } = await supabaseAdmin.from("broadcast_links").select("url").eq("id", linkId).maybeSingle();
  if (!link) return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL || "/");

  // メアドが会員と一致すれば会員として紐づける（未指定時の補完）
  if (memberId == null && email) {
    const { data: mem } = await supabaseAdmin.from("members").select("id").ilike("email", email).eq("is_deleted", false).limit(1);
    memberId = mem?.[0]?.id ?? null;
  }

  // クリックを記録（失敗してもリダイレクトは行う）
  try {
    await supabaseAdmin.from("broadcast_clicks").insert({ link_id: linkId, member_id: memberId, email });
  } catch { /* noop */ }

  // 属性の自動更新（このURLに設定されたアクションを実行）。
  //   fireEvent は例外を投げない＝リダイレクトを妨げない。
  if (memberId) {
    const actions = await resolveLinkActions("broadcast", linkId);
    await fireEvent({ trigger: "link_click", memberId, refKey: `link:b:${linkId}`, actions });
  }

  return NextResponse.redirect(link.url);
}
