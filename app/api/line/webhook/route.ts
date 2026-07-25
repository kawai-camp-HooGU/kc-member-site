// ============================================================
// LINE Webhook 受信（POST）
//   認可＝署名検証（LINEが叩くため requireOps は使わない）。
//   方針：署名検証 → イベント保存 → 即200。重い処理はしない（cronへ委譲）。
//   例外が出ても 200 を返す（LINEに再送させない。失敗は raw 保存＋ログで拾う）。
// ============================================================
import { NextResponse } from "next/server";
import { verifyLineSignature } from "../../../../lib/lineClient";
import { handleLineEvent, type LineWebhookBody } from "../../../../lib/lineServer";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";        // HMAC / Buffer 利用のため Edge 不可
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();     // ← 署名検証には生ボディが必要
  const signature = request.headers.get("x-line-signature") ?? "";

  if (!verifyLineSignature(raw, signature)) {
    return new Response("bad signature", { status: 403 });
  }

  try {
    const body = JSON.parse(raw) as LineWebhookBody;
    for (const ev of body.events ?? []) {
      await handleLineEvent(ev);
    }
  } catch (e) {
    // 握って200へ（LINEの再送を避ける。イベントは raw に残る）
    console.error("line webhook error:", errMessage(e));
  }

  return NextResponse.json({ ok: true });
}
