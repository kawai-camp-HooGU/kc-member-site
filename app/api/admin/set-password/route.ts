import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireAdmin, errorResponse, HttpError } from "../../../../lib/authz";

interface SetPasswordBody { userId?: string; newPassword?: string; }

// 管理者がメンバーのログインパスワードを直接再設定する
export async function POST(request: Request) {
  try {
    // ① 呼び出し元が管理者であることを検証
    const caller = await requireAdmin(request);

    // ② 入力チェック
    const { userId, newPassword } = (await request.json()) as SetPasswordBody;
    if (!userId || !newPassword) {
      throw new HttpError(400, "userId と newPassword は必須です");
    }
    if (String(newPassword).length < 6) {
      throw new HttpError(400, "パスワードは6文字以上にしてください");
    }

    // ③ パスワード再設定（サービスロール）
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: String(newPassword) });
    if (error) {
      throw new HttpError(400, error.message);
    }

    // ④ 監査ログ（コンソール）
    console.log(`[admin/set-password] caller=${caller.userId} target=${userId} at ${new Date().toISOString()}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
