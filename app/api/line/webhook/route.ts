// ============================================================
// 旧・単一アカウント用 Webhook（非推奨）
//   複数アカウント対応により、Webhook はアカウントごとの
//   /api/line/webhook/{channelId} に移行しました。
//   このエンドポイントは使用しません（誤設定の検知用に 410 を返す）。
// ============================================================
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): Response {
  return NextResponse.json(
    { error: "このURLは廃止されました。/api/line/webhook/{channelId} を使用してください" },
    { status: 410 }
  );
}
