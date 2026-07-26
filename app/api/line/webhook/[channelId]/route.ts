// ============================================================
// LINE Webhook 受信（POST）／アカウントごと
//   URL: /api/line/webhook/{channelId}
//   認可＝署名検証（そのアカウントのチャネルシークレットで検証）。
//   方針：チャネル解決 → 署名検証 → イベント保存 → 即200。重い処理はcronへ。
//   例外が出ても 200 を返す（LINEに再送させない。失敗は raw 保存＋ログで拾う）。
// ============================================================
import { NextResponse } from "next/server";
import { verifyLineSignature } from "../../../../../lib/lineClient";
import { handleLineEvent, type LineWebhookBody } from "../../../../../lib/lineServer";
import { getWebhookContext, markAccountReceived } from "../../../../../lib/lineAccountsServer";
import { errMessage } from "../../../../../lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { channelId: string } }
): Promise<Response> {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  // チャネルID → アカウント＋復号済み資格情報
  const ctx = await getWebhookContext(params.channelId);
  if (!ctx) {
    // アカウント未登録／停止中。署名検証もできないため 404。
    return new Response("unknown channel", { status: 404 });
  }

  if (!verifyLineSignature(raw, signature, ctx.channelSecret)) {
    return new Response("bad signature", { status: 403 });
  }

  try {
    const body = JSON.parse(raw) as LineWebhookBody;
    for (const ev of body.events ?? []) {
      await handleLineEvent(ev, { accountId: ctx.accountId, accessToken: ctx.accessToken });
    }
    await markAccountReceived(ctx.accountId);
  } catch (e) {
    console.error("line webhook error:", errMessage(e));
  }

  return NextResponse.json({ ok: true });
}
