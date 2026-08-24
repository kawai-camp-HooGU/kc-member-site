// ============================================================
// POST /api/ai/feedback — 回答への評価（A-8）
//
//   ★ 評価データセットの入口。ここが貯まらないと、改善しても効果を数字で言えない。
//      R6（閾値の較正・評価ケース50件）は、ここに溜まった「役に立たなかった」から作る。
//
//   誰が押せるか
//     ・会員の回答（member_id あり）… ログイン必須。本人の回答だけ
//     ・公開ボット（anon/trial）    … ログイン不要。ただし subject_key が一致する場合だけ
//       → subject_key は IP＋UA（体験版はトークン）から作る決定的な値なので、
//         他人の回答IDを総当たりしても押せない。
//
//   ⚠️ 1つの回答につき評価は1件（ai_feedback_trace_uq）。押し直しは上書き。
//   ⚠️ 理由は選択肢の値だけを受け取る。自由記述にすると個人情報が混ざるうえ、集計できない。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireUser, errorResponse, HttpError, type Caller } from "../../../../lib/authz";
import { subjectKeyFor } from "../../../../lib/bot/botServer";
import { FEEDBACK_REASONS, type AiFeedbackReq } from "../../../../lib/ai/types";
import type { BotEntry } from "../../../../lib/bot/types";

export const runtime = "nodejs";

const sb = supabaseAdmin as unknown as SupabaseClient;
const REASON_KEYS = new Set<string>(FEEDBACK_REASONS.map((r) => r.key));

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || (request.headers.get("x-real-ip") ?? "");
}

interface TraceRow {
  id: number;
  member_id: number | null;
  subject_key: string;
  entry: string;
}

export async function POST(request: Request) {
  try {
    const b = (await request.json().catch(() => ({}))) as Partial<AiFeedbackReq>;

    const traceId = Number(b.traceId);
    if (!Number.isInteger(traceId) || traceId <= 0) {
      throw new HttpError(400, "traceId が不正です。");
    }
    if (b.rating !== 1 && b.rating !== -1) {
      throw new HttpError(400, "rating は 1 または -1 です。");
    }
    // 選択肢に無い値は黙って捨てる（400にしない。評価そのものは受け取りたい）
    const reason = b.rating === -1 && b.reason && REASON_KEYS.has(b.reason) ? b.reason : "";

    // ── 対象の回答を引く ──
    const { data } = await sb.from("ai_traces")
      .select("id, member_id, subject_key, entry").eq("id", traceId).maybeSingle();
    const trace = data as TraceRow | null;
    // 存在しない ID は 404 にせず 400 で返す（総当たりで存在を探れないようにする）
    if (!trace) throw new HttpError(400, "対象の回答が見つかりません。");

    // ── 押せる人か ──
    let memberId: number | null = null;

    if (trace.member_id != null) {
      let caller: Caller | null = null;
      try { caller = await requireUser(request); } catch { caller = null; }
      if (!caller || caller.memberId !== trace.member_id) {
        throw new HttpError(403, "この回答は評価できません。");
      }
      memberId = caller.memberId;
    } else {
      // 公開ボット。subject_key が一致する端末からだけ受け付ける。
      const entry = (trace.entry || "anon") as BotEntry;
      const mine = subjectKeyFor(entry, {
        memberId: null,
        token: b.shareToken ?? null,
        ip: clientIp(request),
        ua: request.headers.get("user-agent") ?? "",
      });
      if (!trace.subject_key || mine !== trace.subject_key) {
        throw new HttpError(403, "この回答は評価できません。");
      }
    }

    // ── 保存（押し直しは上書き）──
    const { error } = await sb.from("ai_feedback").upsert(
      { trace_id: traceId, rating: b.rating, reason, member_id: memberId },
      { onConflict: "trace_id" },
    );
    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
