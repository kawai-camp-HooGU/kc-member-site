import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";

// 入力（ルームID / ルームURL）から ChatWork のルームIDを取り出す
function parseRoomId(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = s.match(/rid(\d+)/i);
  if (m) return m[1] ?? null;
  if (/^\d+$/.test(s)) return s;
  return null;
}

interface TestBody { room?: string; message?: string; }

// ChatWork へテスト通知を送信する。body: { room, message }
export async function POST(request: Request) {
  try {
    // ── 権限チェック：運営のみ ──
    //   未認証だと、第三者が自社の ChatWork トークンを使って
    //   任意のルームへ任意の本文を送れてしまう（スパム／なりすまし経路）。
    await requireOps(request);

    const token = process.env.CHATWORK_API_TOKEN;
    if (!token) {
      throw new HttpError(500, "CHATWORK_API_TOKEN が未設定です（.env.local / Vercel の環境変数に設定してください）");
    }

    const { room, message } = (await request.json()) as TestBody;
    const roomId = parseRoomId(room);
    if (!roomId) {
      throw new HttpError(400, "通知先が不正です。ChatWork のルームID（数字）またはルームURLを入力してください");
    }

    // 本文はサーバー側で固定する（任意本文の送信を許さない）
    const safeMessage = (message ?? "").slice(0, 500) || "KAWAI CAMP テスト通知";
    const body = new URLSearchParams({
      body: safeMessage,
      self_unread: "0",
    });

    const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        "X-ChatWorkToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { errors?: string[] };
        detail = parsed?.errors?.join(", ") || text;
      } catch { /* noop */ }
      return NextResponse.json(
        { error: `ChatWork APIエラー (${res.status}): ${detail}` },
        { status: res.status }
      );
    }

    const json = (text ? JSON.parse(text) : {}) as { message_id?: string };
    return NextResponse.json({ success: true, messageId: json.message_id ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
