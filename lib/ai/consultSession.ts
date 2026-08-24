// ============================================================
// ②返信提案の相談セッション（A-3・サーバー専用）
//
//   ★ クライアントから履歴を受け取らない。ここが唯一の履歴の出どころ。
//     develop.md：「クライアントから受け取った本文をそのままプロンプトに入れない」
//
//   セッションは「担当者 × 相手」で1つ。顧客スレッドを切り替えて戻っても続きから話せる。
//
//   ⚠️ テーブル未適用でも本処理を止めない（develop.md §9）。
//      読めなければ履歴なしで進み、書けなければ黙って捨てる。
//      履歴が無いことより、返信提案そのものが使えなくなるほうが困る。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { clampInput } from "./claude";

const sb = supabaseAdmin as unknown as SupabaseClient;

/** 相談の相手。chat＝アプリ内トーク／line＝LINEトーク */
export type ConsultKind = "chat" | "line";

/** プロンプトへ積む往復数の上限。従来のクライアント保持と同じ12。 */
const MAX_TURNS = 12;
/** 1発言の長さ上限。長い貼り付けでプロンプトが膨らむのを防ぐ。 */
const MAX_CHARS = 3000;

export interface ConsultTurn {
  role: "user" | "assistant";
  content: string;
}

/** 担当者×相手のセッションを取り出す。無ければ作る。失敗したら null。 */
async function getOrCreate(
  staffId: number | null, kind: ConsultKind, subjectId: number,
): Promise<number | null> {
  if (staffId == null) return null;
  try {
    const { data: found } = await sb.from("ai_consult_sessions")
      .select("id").eq("staff_id", staffId).eq("kind", kind).eq("subject_id", subjectId)
      .maybeSingle();
    const id = (found as { id?: number } | null)?.id;
    if (id) return id;

    const { data: created } = await sb.from("ai_consult_sessions")
      .insert({ staff_id: staffId, kind, subject_id: subjectId })
      .select("id").single();
    return (created as { id?: number } | null)?.id ?? null;
  } catch {
    return null;   // 未適用・接続断など
  }
}

/**
 * プロンプトに積む相談履歴を取り出す。
 * ⚠️ 返すのはサーバーに保存された内容だけ。リクエスト本文は一切見ない。
 */
export async function loadConsultHistory(
  staffId: number | null, kind: ConsultKind, subjectId: number,
): Promise<{ sessionId: number | null; turns: ConsultTurn[] }> {
  const sessionId = await getOrCreate(staffId, kind, subjectId);
  if (sessionId == null) return { sessionId: null, turns: [] };

  try {
    // 新しい順に取ってから戻す（古い方を落とすため）
    const { data } = await sb.from("ai_consult_turns")
      .select("role, body")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(MAX_TURNS);

    const rows = ((data as { role: string; body: string | null }[] | null) ?? []).reverse();
    const turns: ConsultTurn[] = rows.map((r) => ({
      role: r.role === "assistant" ? "assistant" : "user",
      content: clampInput(r.body ?? "", MAX_CHARS),
    }));
    return { sessionId, turns };
  } catch {
    return { sessionId, turns: [] };
  }
}

/**
 * 今回のやり取りを追記する。
 * ⚠️ 残すのは「オペレーターの相談文」と「AIの説明（talk）」だけ。
 *    返信案カードの本文は残さない（顧客へ送る文面は chat_messages 側に残るため、二重に持たない）。
 */
export async function appendConsultTurns(
  sessionId: number | null, turns: ConsultTurn[],
): Promise<void> {
  if (sessionId == null) return;
  const rows = turns
    .filter((t) => (t.content ?? "").trim())
    .map((t) => ({ session_id: sessionId, role: t.role, body: clampInput(t.content, MAX_CHARS) }));
  if (rows.length === 0) return;
  try {
    await sb.from("ai_consult_turns").insert(rows);
    await sb.from("ai_consult_sessions").update({ last_at: new Date().toISOString() }).eq("id", sessionId);
  } catch {
    // 記録できなくても回答は返す（develop.md §9：失敗時は本処理を止めない）
  }
}

/** 相談ログをやり直す（画面の「リセット」）。セッション自体は残す。 */
export async function resetConsultSession(
  staffId: number | null, kind: ConsultKind, subjectId: number,
): Promise<void> {
  const sessionId = await getOrCreate(staffId, kind, subjectId);
  if (sessionId == null) return;
  try {
    await sb.from("ai_consult_turns").delete().eq("session_id", sessionId);
  } catch {
    // 消せなくても画面側の表示はリセットされる
  }
}
