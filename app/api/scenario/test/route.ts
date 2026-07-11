import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";
import { renderMessage } from "../../../../lib/broadcast";
import { sendMail, isEmailConfigured } from "../../../../lib/email";
import type { Member } from "../../../../lib/models";

interface Body { scenarioId?: number; email?: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(t).replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</div>`;

// 一括テスト：シナリオの全ステップを、遅延を無視して指定アドレスへ即時メール送信（計測なし）。
export async function POST(request: Request) {
  try {
    const { scenarioId, email } = (await request.json()) as Body;
    if (scenarioId == null || !email) return NextResponse.json({ error: "scenarioIdと送信先メールは必須です" }, { status: 400 });

    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { data: caller, error: cErr } = await supabaseAdmin.auth.getUser(token);
    if (cErr || !caller?.user) return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    const { data: me } = await supabaseAdmin.from("members").select("name, kana, company, prefecture, source, email, role").eq("user_id", caller.user.id).eq("is_deleted", false).maybeSingle();
    if (me?.role !== "管理者" && me?.role !== "オペレーター") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    if (!isEmailConfigured()) return NextResponse.json({ error: "メール送信（SMTP）が未設定です。SMTP_HOST/USER/PASS を設定してください。" }, { status: 500 });

    const { data: sc } = await supabaseAdmin.from("scenarios").select("name").eq("id", scenarioId).maybeSingle();
    const { data: steps } = await supabaseAdmin.from("scenario_steps").select("*").eq("scenario_id", scenarioId).order("sort_order");
    if (!steps || steps.length === 0) return NextResponse.json({ error: "ステップがありません" }, { status: 400 });

    const sample: Partial<Member> = { name: me?.name ?? "テスト太郎", kana: me?.kana ?? "テストタロウ", company: me?.company ?? "", prefecture: me?.prefecture ?? "", source: me?.source ?? "", email: me?.email ?? email };
    let n = 0;
    for (const st of steps) {
      n += 1;
      const body = renderMessage(st.message_body ?? "", sample);
      await sendMail({ to: email, subject: `[テスト][${sc?.name ?? "シナリオ"}] ステップ${n}`, text: body, html: toHtml(body) });
    }
    return NextResponse.json({ success: true, count: n });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
