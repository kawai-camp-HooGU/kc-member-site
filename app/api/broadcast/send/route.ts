import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";
import { runBroadcast } from "../../../../lib/broadcastSend";

interface Body { broadcastId?: number }

// 即時配信（スタッフのみ）。予約は cron から runBroadcast が呼ばれる。
export async function POST(request: Request) {
  try {
    const { broadcastId } = (await request.json()) as Body;
    if (broadcastId == null) return NextResponse.json({ error: "broadcastId は必須です" }, { status: 400 });

    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { data: caller, error: cErr } = await supabaseAdmin.auth.getUser(token);
    if (cErr || !caller?.user) return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    const { data: meRows } = await supabaseAdmin.from("members").select("role").eq("user_id", caller.user.id).eq("is_deleted", false).limit(1);
    const role = meRows?.[0]?.role;
    if (role !== "管理者" && role !== "オペレーター") return NextResponse.json({ error: "配信する権限がありません" }, { status: 403 });

    const result = await runBroadcast(broadcastId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "配信に失敗しました" }, { status: 500 });
    return NextResponse.json({ success: true, recipientCount: result.recipientCount });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
