import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../../lib/authz";
import { buildAutoReply } from "../../../../../lib/formParse";
import type { AnswerMap } from "../../../../../lib/formParse";
import { sendMail, isEmailConfigured } from "../../../../../lib/email";
import type { FormDef } from "../../../../../lib/models";

interface Body {
  email?: string;
  /** 編集中（未保存）の内容で試せるよう、フォーム定義をそのまま受け取る */
  form?: FormDef;
  /** 条件ブロックの評価に使う仮の回答（fieldId → 値） */
  answers?: Record<string, string | string[]>;
}

/**
 * 自動返信メールのテスト送信（スタッフのみ）。
 *   「届かない」ときの切り分け用。SMTP未設定・本文空・条件不成立を
 *   それぞれ別のメッセージで返し、どこで止まっているか分かるようにする。
 */
export async function POST(request: Request) {
  try {
    await requireOps(request);

    const { email, form, answers } = (await request.json()) as Body;
    if (!email || !email.includes("@")) throw new HttpError(400, "送信先メールアドレスを入力してください");
    if (!form) throw new HttpError(400, "フォームの内容が取得できませんでした");

    if (!isEmailConfigured()) {
      throw new HttpError(
        500,
        "メール送信（SMTP）が未設定のため送信できません。" +
        "環境変数 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM を設定してください。",
      );
    }
    if (!form.design?.autoReply?.enabled) {
      throw new HttpError(400, "自動返信メールが OFF になっています。チェックを入れてからお試しください。");
    }

    const map: AnswerMap = {};
    for (const [k, v] of Object.entries(answers ?? {})) {
      const id = Number(k);
      if (Number.isFinite(id)) map[id] = v;
    }

    const built = buildAutoReply(form, map, {
      formName: form.name || form.title || "フォーム",
      name: "テスト太郎",
      email,
      answeredAt: new Date(),
    });
    if (!built) {
      throw new HttpError(
        400,
        "送信する本文がありません。本文ブロックが空か、条件を満たすブロックが1つもない状態です。",
      );
    }

    await sendMail({
      to: email,
      subject: `[テスト] ${built.subject}`,
      text: `※ これは自動返信メールのテスト送信です。差し込みはサンプル値です。\n\n${built.text}`,
      fromName: form.design.autoReply.fromName,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
