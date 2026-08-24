// ============================================================
// GET /api/ai/consult-threads — ①AI相談の過去スレッド（B-4）
//
//   ?         … 自分のスレッド一覧（新しい順）
//   ?id=123   … そのスレッドの発言（古い順）
//
//   ★ なぜ要るか
//     ai_conversations / ai_messages には履歴が残っているのに、画面が読んでいなかった。
//     開くたびに会話がリセットされ、DBにあるものが使われていない状態だった（B-4）。
//
//   ⚠️ 会員本人のスレッドだけ。member_id での絞り込みを外さないこと。
//      service_role で読むため、RLS は効かない。ここの where が唯一の防壁になる。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireUser, errorResponse, HttpError } from "../../../../lib/authz";
import type { AiCitation, AiConsultThread, AiConsultTurn } from "../../../../lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 一覧に出すスレッド数。古いものは切る（無限に増える画面にしない）。 */
const MAX_THREADS = 30;
/** 1スレッドで復元する発言数。長い相談は古い方を落とす。 */
const MAX_TURNS = 60;

const asCitations = (v: unknown): AiCitation[] =>
  Array.isArray(v) ? (v as AiCitation[]) : [];

export async function GET(request: Request) {
  try {
    const caller = await requireUser(request);
    const memberId = caller.memberId;
    if (memberId == null) throw new HttpError(403, "会員のみ利用できます。");

    const url = new URL(request.url);
    const idRaw = url.searchParams.get("id");

    // ── 1スレッドの発言 ──
    if (idRaw) {
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id が不正です。");

      // ★ 他人のスレッドを開けないよう、必ず member_id で確認してから読む
      const { data: own } = await supabaseAdmin
        .from("ai_conversations").select("id").eq("id", id).eq("member_id", memberId).maybeSingle();
      if (!own) throw new HttpError(404, "スレッドが見つかりません。");

      const { data } = await supabaseAdmin
        .from("ai_messages")
        .select("id, role, body, citations, escalate, created_at")
        .eq("ai_conversation_id", id)
        .order("created_at", { ascending: true })
        .limit(MAX_TURNS);

      const turns: AiConsultTurn[] = ((data ?? []) as {
        id: number; role: string; body: string | null; citations: unknown;
        escalate: boolean | null; created_at: string | null;
      }[]).map((m) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        body: m.body ?? "",
        citations: asCitations(m.citations),
        escalate: Boolean(m.escalate),
        createdAt: m.created_at ?? "",
      }));

      return NextResponse.json({ id, turns });
    }

    // ── 一覧 ──
    const { data: convs } = await supabaseAdmin
      .from("ai_conversations")
      .select("id, title, created_at, escalated_conversation_id")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(MAX_THREADS);

    const rows = (convs ?? []) as {
      id: number; title: string | null; created_at: string | null;
      escalated_conversation_id: number | null;
    }[];
    if (rows.length === 0) return NextResponse.json({ threads: [] });

    // 最終発言の日時をまとめて引く（スレッドごとに1クエリ投げない）
    const ids = rows.map((r) => r.id);
    const { data: msgs } = await supabaseAdmin
      .from("ai_messages")
      .select("ai_conversation_id, body, created_at")
      .in("ai_conversation_id", ids)
      .order("created_at", { ascending: false });

    const lastAt = new Map<number, string>();
    const lastBody = new Map<number, string>();
    const count = new Map<number, number>();
    for (const m of (msgs ?? []) as {
      ai_conversation_id: number; body: string | null; created_at: string | null;
    }[]) {
      const k = m.ai_conversation_id;
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!lastAt.has(k)) {
        lastAt.set(k, m.created_at ?? "");
        lastBody.set(k, (m.body ?? "").slice(0, 60));
      }
    }

    const threads: AiConsultThread[] = rows
      // 1件も発言が無いスレッド（作成直後に落ちた等）は出さない
      .filter((r) => (count.get(r.id) ?? 0) > 0)
      .map((r) => ({
        id: r.id,
        title: (r.title ?? "").trim() || (lastBody.get(r.id) ?? "無題の相談"),
        lastAt: lastAt.get(r.id) ?? r.created_at ?? "",
        messageCount: count.get(r.id) ?? 0,
        escalated: r.escalated_conversation_id != null,
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

    return NextResponse.json({ threads });
  } catch (err) {
    return errorResponse(err);
  }
}
