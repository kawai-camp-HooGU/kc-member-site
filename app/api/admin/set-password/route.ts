import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";

interface SetPasswordBody { userId?: string; newPassword?: string; }

// 管理者がメンバーのログインパスワードを直接再設定する
export async function POST(request: Request) {
  try {
    // ① 呼び出し元の認証トークンを検証
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    }
    const callerId = callerData.user.id;

    // ② 呼び出し元が管理者か確認
    const { data: meRows, error: meErr } = await supabaseAdmin
      .from("members")
      .select("role")
      .eq("user_id", callerId)
      .eq("is_deleted", false)
      .limit(1);
    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 500 });
    }
    if (!meRows || meRows.length === 0 || meRows[0]?.role !== "管理者") {
      return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
    }

    // ③ 入力チェック
    const { userId, newPassword } = (await request.json()) as SetPasswordBody;
    if (!userId || !newPassword) {
      return NextResponse.json({ error: "userId と newPassword は必須です" }, { status: 400 });
    }
    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: "パスワードは6文字以上にしてください" }, { status: 400 });
    }

    // ④ パスワード再設定（サービスロール）
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: String(newPassword) });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ⑤ 監査ログ（コンソール）
    console.log(`[admin/set-password] caller=${callerId} target=${userId} at ${new Date().toISOString()}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e, "サーバーエラー") }, { status: 500 });
  }
}
