import { NextResponse } from "next/server";
import { reissueTrialToken } from "../../../../lib/formsServer";
import { errMessage } from "../../../../lib/errors";

interface Body { submissionId?: number }

// 体験ログイン用トークンの再発行。
//   回答直後にトークンを受け取れなかった外部ロールの回答者を、
//   「ポータルに入る」ボタンから入場させるための出口。
//   ⚠️ キーは直近の submissionId。発行は外部ロールに限る（formsServer 側で担保）。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const id = Number(body.submissionId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "submissionId が不正です" }, { status: 400 });
    }
    const result = await reissueTrialToken(id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errMessage(err) }, { status: 500 });
  }
}
