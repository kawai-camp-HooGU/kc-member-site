import { NextResponse } from "next/server";
import { submitForm } from "../../../../lib/formsServer";
import type { AnswerMap } from "../../../../lib/formParse";
import { errMessage } from "../../../../lib/errors";

interface Body {
  slug?: string;
  answers?: Record<string, string | string[]>;
  files?: Record<string, { name: string; dataUrl: string }>;
  guestName?: string;
  guestEmail?: string;
  source?: string;
}

// 公開フォームの送信。未ログインでも受け付ける（service role で保存）。
// ログイン中の会員は Authorization ヘッダを送ることで本人に自動紐付けされる。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.slug) return NextResponse.json({ ok: false, error: "slug が指定されていません" }, { status: 400 });

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || null;

    // キーを数値（fieldId）に戻す
    const answers: AnswerMap = {};
    for (const [k, v] of Object.entries(body.answers ?? {})) {
      const id = Number(k);
      if (Number.isFinite(id)) answers[id] = v;
    }
    const files: Record<number, { name: string; dataUrl: string }> = {};
    for (const [k, v] of Object.entries(body.files ?? {})) {
      const id = Number(k);
      if (Number.isFinite(id) && v?.dataUrl) files[id] = v;
    }

    const result = await submitForm({
      slug: body.slug,
      answers,
      files,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      source: body.source,
      token,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errMessage(err) }, { status: 500 });
  }
}
