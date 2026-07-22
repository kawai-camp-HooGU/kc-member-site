// ============================================================
// 会員未登録メールアドレスへの運営メモ（運営のみ）
//   PUT /api/ops/unregistered-notes  { email, note } → { ok: true }
//
//   会員ではないので members には書けない。メールアドレスを主キーにした
//   unregistered_notes に upsert する。
//   ⚠️ email は小文字へ正規化してから読み書きする（一覧側の集計と揃える）。
//   ⚠️ その人が後から会員登録されても行は消さない。一覧からは自然に
//      消えるが、メモは残しておいた方が運用しやすいため。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

interface Body { email?: string; note?: string }

export async function PUT(request: Request) {
  try {
    const me = await requireOps(request);

    const { email, note } = (await request.json()) as Body;
    const key = (email ?? "").trim().toLowerCase();
    if (!key || !key.includes("@")) throw new HttpError(400, "メールアドレスが不正です");

    // 「誰が最後に書いたか」は表示用のスナップショット。
    // members を引き直さなくても一覧に出せるよう、氏名を焼き付けておく。
    let by = "";
    if (me.memberId != null) {
      const { data } = await supabaseAdmin
        .from("members").select("name").eq("id", me.memberId).maybeSingle();
      by = data?.name ?? "";
    }

    const { error } = await supabaseAdmin.from("unregistered_notes").upsert({
      email: key,
      note: (note ?? "").slice(0, 2000),
      updated_by: by,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ ok: true, updatedBy: by });
  } catch (err) {
    return errorResponse(err);
  }
}
