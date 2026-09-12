// ============================================================
// POST /api/trial/review — 講評を送信する（運営専用）
//
//   ★ 講評は運営が人で書く（設計 決定6b）。ここは「送信」の一手だけを担う。
//     下書きの保存はクライアントから直接 supabase（RLSは運営のみ）。
//
//   ⚠️ 利用者へメールが飛ぶ＝外向きの作用。必ず requireOps を通す。
//   ⚠️ 送信は1回だけ（冪等）。sent_at が入っていたら二度目は送らない。
//   ⚠️ メールの失敗で run の状態を進めない（届いていないのに「講評済み」にしない）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { sendMail } from "../../../../lib/email";
import { errMessage } from "../../../../lib/errors";

export const runtime = "nodejs";
/** ⚠️ 既定のままだと途中で打ち切られる（メール送信）。 */
export const maxDuration = 60;

const sb = supabaseAdmin as unknown as SupabaseClient;

interface Body { runId?: number }

export async function POST(request: Request) {
  try {
    // 権限：UI（usePermission）と API の両方で見る（develop.md §10）
    const me = await requireOps(request);

    const body = (await request.json().catch(() => ({}))) as Body;
    const runId = Number(body.runId);
    if (!Number.isFinite(runId)) throw new HttpError(400, "runId が不正です");

    const { data: runRow } = await sb
      .from("bot_trial_runs")
      .select("id, scenario_id, member_id, submitted_at, status")
      .eq("id", runId)
      .maybeSingle();
    const run = runRow as {
      id: number; scenario_id: number; member_id: number | null;
      submitted_at: string | null; status: string;
    } | null;
    if (!run) throw new HttpError(404, "その提出は見つかりませんでした");
    if (!run.submitted_at) throw new HttpError(400, "まだ提出されていません");

    const { data: revRow } = await sb
      .from("bot_trial_reviews")
      .select("id, comment, sent_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const review = revRow as { id: number; comment: string; sent_at: string | null } | null;
    if (!review) throw new HttpError(400, "講評がまだ書かれていません");
    if (review.sent_at) throw new HttpError(409, "この講評はすでに送信済みです");
    if (!(review.comment ?? "").trim()) throw new HttpError(400, "講評の本文が空です");

    // ── 宛先。提出時にフォーム経由で会員になっているはず ──
    if (run.member_id == null) {
      throw new HttpError(400, "宛先が分かりません。提出時の会員登録が完了していない可能性があります。");
    }
    const { data: memRow } = await sb
      .from("members")
      .select("id, name, email")
      .eq("id", run.member_id)
      .maybeSingle();
    const member = memRow as { id: number; name: string; email: string } | null;
    if (!member?.email) throw new HttpError(400, "宛先のメールアドレスが登録されていません");

    const { data: scRow } = await sb
      .from("bot_trial_scenarios").select("title").eq("id", run.scenario_id).maybeSingle();
    const scenarioTitle = (scRow as { title?: string } | null)?.title ?? "体験";

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const text = [
      `${member.name || "ご担当者"} 様`,
      "",
      `先日ご提出いただいた「${scenarioTitle}」に、担当者が目を通しました。`,
      "",
      "──────────",
      review.comment.trim(),
      "──────────",
      "",
      base ? `作ったものは会員ポータルからいつでもご覧いただけます。\n${base}/login` : "",
      "",
      "KAWAI CAMP 事務局",
    ].filter((l) => l !== "").join("\n");

    try {
      await sendMail({
        to: member.email,
        subject: `【KAWAI CAMP】「${scenarioTitle}」の講評をお届けします`,
        text,
      });
    } catch (e: unknown) {
      // ⚠️ 届いていないのに「講評済み」にしない
      throw new HttpError(502, `メールを送信できませんでした：${errMessage(e)}`);
    }

    const now = new Date().toISOString();
    await sb.from("bot_trial_reviews")
      .update({ sent_at: now, reviewer_id: me.memberId })
      .eq("id", review.id);
    await sb.from("bot_trial_runs")
      .update({ status: "reviewed", updated_at: now })
      .eq("id", runId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
