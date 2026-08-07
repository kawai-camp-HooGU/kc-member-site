import { NextResponse } from "next/server";
import { resolveUnsubscribe, addSuppression } from "../../../lib/suppressionServer";

// 配信停止（公開リンク）。メール本文の停止リンク / List-Unsubscribe から呼ばれる。
//   GET  … リンククリック（ブラウザ表示）→ 停止登録 → 確認HTMLを返す
//   POST … RFC 8058 One-Click（メールクライアントの「登録解除」）→ 停止登録 → 204

function page(title: string, body: string): Response {
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;background:#f4f4f5;margin:0;padding:0;color:#17171b}
.box{max-width:460px;margin:12vh auto;background:#fff;border:1px solid #e5e5e8;border-radius:16px;padding:28px 26px;text-align:center;box-shadow:0 6px 24px rgba(20,20,30,.06)}
h1{font-size:18px;margin:0 0 10px}p{font-size:14px;color:#555;line-height:1.8;margin:0}</style></head>
<body><div class="box"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = resolveUnsubscribe(searchParams.get("e"), searchParams.get("s"));
  if (!email) return page("リンクが無効です", "お手数ですが、最新のメールに記載のリンクからお試しください。");
  try {
    await addSuppression(email, "本人が停止");
    return page("配信を停止しました", `今後、このメールアドレス宛の配信は行われません。<br>ご利用ありがとうございました。`);
  } catch {
    return page("処理に失敗しました", "時間をおいて再度お試しください。");
  }
}

// One-Click（List-Unsubscribe-Post: List-Unsubscribe=One-Click）
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = resolveUnsubscribe(searchParams.get("e"), searchParams.get("s"));
  if (!email) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await addSuppression(email, "本人が停止（One-Click）");
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
