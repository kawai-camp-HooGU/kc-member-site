import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { renderMessage } from "../../../../lib/broadcast";
import { sourceLabeler } from "../../../../lib/sourcesServer";
import { sendMail, isEmailConfigured } from "../../../../lib/email";
import type { Member } from "../../../../lib/models";

interface Body { title?: string; message?: string; email?: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(t).replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</div>`;

// テスト送信（スタッフのみ）。指定アドレスへ、自分の情報で変数差し込みしたメールを送る（計測なし）。
export async function POST(request: Request) {
  try {
    const caller = await requireOps(request);

    const { title, message, email } = (await request.json()) as Body;
    if (!message || !email) throw new HttpError(400, "本文と送信先メールは必須です");

    const { data: me } = await supabaseAdmin
      .from("members").select("name, kana, company, prefecture, source_id, email")
      .eq("id", caller.memberId as number).maybeSingle();

    if (!isEmailConfigured()) throw new HttpError(500, "メール送信（SMTP）が未設定です。環境変数 SMTP_HOST/USER/PASS を設定してください。");

    const sample: Partial<Member> = {
      name: me?.name ?? "テスト太郎", kana: me?.kana ?? "テストタロウ",
      company: me?.company ?? "", prefecture: me?.prefecture ?? "",
      sourceId: me?.source_id ?? null, email: me?.email ?? email,
    };
    const body = renderMessage(message, sample, await sourceLabeler());
    await sendMail({ to: email, subject: `[テスト] ${title || "KAWAI CAMP からのお知らせ"}`, text: body, html: toHtml(body) });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
