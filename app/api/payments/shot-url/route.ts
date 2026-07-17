// ============================================================
// 決済スクショの署名URL発行
//
//   POST /api/payments/shot-url  { paymentId }  →  { url }
//
//   ・運営のみ（requireOps）。
//   ・payment-shots はプライベート。署名URL（5分）の発行は service role だけ。
//   ・発行のたびに payment_shot_views に1行残す（誰が見たか）。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse } from "../../../../lib/authz";

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const { paymentId } = (await request.json()) as { paymentId?: number };
    if (!paymentId) return NextResponse.json({ error: "paymentId は必須です" }, { status: 400 });

    const { data: p } = await supabaseAdmin
      .from("payments").select("id, screenshot_path")
      .eq("id", paymentId).eq("is_deleted", false).maybeSingle();
    if (!p || !p.screenshot_path) {
      return NextResponse.json({ error: "スクリーンショットが見つかりません" }, { status: 404 });
    }

    const { data: signed, error } = await supabaseAdmin.storage
      .from("payment-shots").createSignedUrl(p.screenshot_path, 300);
    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: "URLを発行できませんでした" }, { status: 500 });
    }

    await supabaseAdmin.from("payment_shot_views")
      .insert({ payment_id: p.id, viewer_id: me.memberId })
      .then(({ error: e }) => { if (e) console.warn("閲覧ログの記録に失敗:", e.message); });

    return NextResponse.json({ url: signed.signedUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
