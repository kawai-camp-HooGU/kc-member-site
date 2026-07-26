// ============================================================
// LINEアカウント管理（POST）：追加/編集/削除/接続テスト
//   運営のみ（requireOps）。可否の細かな出し分けは権限マスタ（line_account）で制御し、
//   画面側でボタンを出し分ける。サーバーは運営ロールであることを担保する。
//   一覧・状態の参照はクライアントから RLS(運営) で直接 supabase（lib/lineAccounts.ts）。
//   ⚠️ シークレット/アクセストークンはこの API 経由でのみ登録（暗号化して隔離保存）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { isLineSecretKeyConfigured } from "../../../../lib/lineCrypto";
import {
  createAccount, updateAccount, softDeleteAccount, testConnection,
} from "../../../../lib/lineAccountsServer";

interface Body {
  action?: "create" | "update" | "delete" | "test";
  id?: number;
  name?: string;
  channelId?: string;
  env?: "prod" | "test";
  status?: "connected" | "needs_action" | "paused";
  channelSecret?: string;
  accessToken?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireOps(request);
    const b = (await request.json()) as Body;

    if (b.action === "create") {
      if (!isLineSecretKeyConfigured()) throw new HttpError(500, "LINE_SECRET_KEY が未設定です（暗号化鍵）");
      const name = (b.name ?? "").trim();
      const channelId = (b.channelId ?? "").trim();
      const channelSecret = (b.channelSecret ?? "").trim();
      const accessToken = (b.accessToken ?? "").trim();
      if (!channelId || !channelSecret || !accessToken) {
        throw new HttpError(400, "チャネルID・シークレット・アクセストークンは必須です");
      }
      const created = await createAccount({
        name: name || channelId,
        channelId,
        env: b.env === "test" ? "test" : "prod",
        channelSecret,
        accessToken,
      });
      // 追加直後に接続テストを実行して状態を確定
      let result: unknown = null;
      if (created) result = await testConnection(created.id);
      return NextResponse.json({ ok: true, id: created?.id, result });
    }

    if (b.action === "update") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      await updateAccount(b.id, {
        name: b.name,
        env: b.env,
        status: b.status,
        channelSecret: b.channelSecret,
        accessToken: b.accessToken,
      });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "delete") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      await softDeleteAccount(b.id);
      return NextResponse.json({ ok: true });
    }

    if (b.action === "test") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      const result = await testConnection(b.id);
      return NextResponse.json({ ok: true, result });
    }

    throw new HttpError(400, "action が不正です");
  } catch (err) {
    return errorResponse(err);
  }
}
