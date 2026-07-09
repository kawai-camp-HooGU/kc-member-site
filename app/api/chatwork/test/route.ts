import { NextResponse } from "next/server";
import { errMessage } from "../../../../lib/errors";

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
    const token = process.env.CHATWORK_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "CHATWORK_API_TOKEN が未設定です（.env.local / Vercel の環境変数に設定してください）" },
        { status: 500 }
      );
    }

    const { room, message } = (await request.json()) as TestBody;
    const roomId = parseRoomId(room);
    if (!roomId) {
      return NextResponse.json(
        { error: "通知先が不正です。ChatWork のルームID（数字）またはルームURLを入力してください" },
        { status: 400 }
      );
    }

    const body = new URLSearchParams({
      body: message ?? "KAWAI CAMP テスト通知",
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
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
