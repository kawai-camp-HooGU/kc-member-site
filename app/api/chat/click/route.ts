// ============================================================
// チャット本文のリンク計測
//
//   /api/chat/click?l=<chat_links.id>  →  記録して元URLへリダイレクト
//
//   ・会員が踏んだかどうかを運営画面に出すためのリダイレクタ。
//   ・1メッセージ＝1会話＝1会員なので、誰が踏んだかは link から辿れる（?m= は不要）。
//   ・初回の訪問日時（clicked_at）と、最終訪問・回数を記録する。
//
//   ⚠️ 記録に失敗してもリダイレクトは必ず行う（本流を止めない）。
//   ⚠️ 会員が本文のURLを目視でコピーして直接開いた場合は記録されない。
//      あくまで「このリンクから飛んだ」ことの記録。
//   ⚠️ middleware の matcher から除外している（未ログインでも踏まれ得るため）。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const linkId = Number(searchParams.get("l"));
  if (!linkId) return NextResponse.redirect(new URL("/", origin));

  const { data: link } = await supabaseAdmin
    .from("chat_links").select("id, url, clicked_at, click_count").eq("id", linkId).maybeSingle();
  if (!link) return NextResponse.redirect(new URL("/", origin));

  try {
    const now = new Date().toISOString();
    await supabaseAdmin.from("chat_links").update({
      clicked_at: link.clicked_at ?? now,           // 初回は上書きしない
      last_click_at: now,
      click_count: (link.click_count ?? 0) + 1,
    }).eq("id", link.id);
  } catch (e) {
    console.error("チャットリンクの計測に失敗:", e);
  }

  return NextResponse.redirect(link.url);
}
