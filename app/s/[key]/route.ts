// ============================================================
// 流入経路の計測リダイレクタ（公開URL）
//
//   /s/{key}  →  誘導先（landing_path、既定 /login）へ転送
//
//   ・ログイン中の会員が踏んだ場合
//       members.last_source_id を更新（初回なら source_id / source_at も）
//       → 経路アクション（属性付与・シナリオ・チャット送信）を発火
//   ・未ログインの場合
//       何も記録せず、誘導先へ ?src={key} 付きで転送する。
//       会員化・発火は従来どおりフォーム送信時（lib/formsServer.ts）に行われる。
//
//   ⚠️ 停止中（is_active=false）の経路は「新規付与だけ止める」仕様なので、
//      記録もアクションも行わず、転送だけする（配布済みURLを死なせない）。
//   ⚠️ fireEvent は例外を投げない設計。アクションの失敗で転送を止めない。
//   ⚠️ 広告側が付ける追加パラメータ（gclid など）はそのまま誘導先へ引き継ぐ。
//
//   参照: docs/Phase3_流入経路マスタ.md ／ lib/actionsServer.ts
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createSupabaseServer } from "../../../lib/supabaseServer";
import { fireSourceEvent } from "../../../lib/actionsServer";
import { toSource, sourceLandingUrl } from "../../../lib/sources";
import { MEMBER_LOGIN } from "../../../lib/zone";

export async function GET(
  request: Request,
  { params }: { params: { key: string } },
) {
  const { origin, searchParams } = new URL(request.url);
  const key = (params.key ?? "").trim();

  // ── 経路を引く（見つからなければログイン画面へ。存在しないキーを教えない）──
  const { data: row } = await supabaseAdmin
    .from("sources").select("*").eq("key", key).eq("is_deleted", false).maybeSingle();
  if (!row) return NextResponse.redirect(new URL(MEMBER_LOGIN, origin));

  const source = toSource(row);
  const target = new URL(sourceLandingUrl(source, origin));
  // 広告側が付けた追加パラメータを引き継ぐ（src / utm_* は経路の設定を優先）
  searchParams.forEach((v, k) => {
    if (!target.searchParams.has(k)) target.searchParams.set(k, v);
  });

  if (!source.isActive) return NextResponse.redirect(target);

  // ── ログイン中なら「この会員が踏んだ」として記録し、アクションを発火 ──
  try {
    const supabase = createSupabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (userId) {
      const { data: member } = await supabaseAdmin
        .from("members").select("id, source_id")
        .eq("user_id", userId).eq("is_deleted", false).maybeSingle();

      if (member) {
        // 最新流入は毎回更新。初回流入（source_id）はファーストクリック方式で上書きしない。
        await supabaseAdmin.from("members")
          .update({ last_source_id: source.id }).eq("id", member.id);
        if (member.source_id == null) {
          await supabaseAdmin.from("members")
            .update({ source_id: source.id, source_at: new Date().toISOString() })
            .eq("id", member.id);
        }
        await fireSourceEvent(member.id, source.id);
      }
    }
  } catch (e) {
    // 記録・発火に失敗しても転送は必ず行う（本流を止めない）
    console.error("/s/[key]: 経路の記録に失敗", key, e);
  }

  return NextResponse.redirect(target);
}
