// ============================================================
// 公開ボットの会話セッション（S-5・サーバー専用）
//
//   画面には履歴が見えているのに、AIは1問ごとに忘れていた。直近N往復を渡して覚えさせる。
//
//   ★ セッションの鍵は token（クライアントが保持して送り返す）
//     subject_key（anon は sha256(IP|UA)）を鍵にしてはいけない。
//     同じ社内NAT・同じブラウザの別人が同一キーになりうるため、
//     他人の会話の続きをAIが読むことになる。
//     token は推測できないランダム値。当てずっぽうでは他人の会話に入れない。
//
//   ⚠️ テーブル未適用でも本処理を止めない（develop.md §9）。
//      読めなければ履歴なし＝従来どおりの挙動で動く。
// ============================================================
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import type { AiMessage } from "../ai/claude";
import type { BotEntry, BotSource } from "./types";

const sb = supabaseAdmin as unknown as SupabaseClient;

/** プロンプトへ積む往復数（user+assistant で1往復）。project_config.memory.turns 相当。 */
const TURNS = Number(process.env.AI_BOT_MEMORY_TURNS ?? 8);
/** 1発言の長さ上限。長い貼り付けでプロンプトが膨らむのを防ぐ。 */
const MAX_CHARS = 2000;
/**
 * セッションが続いているとみなす時間。これを過ぎたら新しい会話として扱う。
 * ⚠️ 長すぎると「昨日の話」を持ち出してくる。短すぎると途中で忘れる。
 */
const TTL_MS = Number(process.env.AI_BOT_SESSION_TTL_MIN ?? 180) * 60_000;

export interface BotSessionCtx {
  id: number | null;
  token: string | null;
  history: AiMessage[];
}

const newToken = (): string => randomBytes(24).toString("hex");

/**
 * セッションを解決する。
 *   token が有効なら続き、無効／期限切れ／未指定なら新規。
 *   ⚠️ token は他人のものかもしれない前提で扱う。当たっても entry が違えば使わせない。
 */
export async function resolveBotSession(
  token: string | null | undefined,
  o: { entry: BotEntry; subjectKey: string; memberId: number | null },
): Promise<BotSessionCtx> {
  try {
    if (token) {
      const { data } = await sb.from("bot_sessions")
        .select("id, token, entry, last_at").eq("token", token).maybeSingle();
      const row = data as { id: number; token: string; entry: string; last_at: string } | null;
      const fresh = row && Date.now() - new Date(row.last_at).getTime() < TTL_MS;
      // 入口が変わったら別の会話として扱う（体験版→会員 等で文脈が混ざらないように）
      if (row && fresh && row.entry === o.entry) {
        return { id: row.id, token: row.token, history: await loadHistory(row.id) };
      }
    }

    const t = newToken();
    const { data: created } = await sb.from("bot_sessions")
      .insert({
        token: t, entry: o.entry, subject_key: o.subjectKey, member_id: o.memberId,
      })
      .select("id").single();
    const id = (created as { id?: number } | null)?.id ?? null;
    return { id, token: id != null ? t : null, history: [] };
  } catch {
    // 未適用・接続断など。履歴なしで進む（従来どおりの挙動）
    return { id: null, token: null, history: [] };
  }
}

/** 直近 N 往復を LLM へ渡す形にする（古い順）。 */
async function loadHistory(sessionId: number): Promise<AiMessage[]> {
  try {
    const { data } = await sb.from("bot_messages")
      .select("role, body")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(TURNS * 2);
    const rows = ((data as { role: string; body: string | null }[] | null) ?? []).reverse();
    return rows
      .filter((r) => (r.body ?? "").trim())
      .map((r) => ({
        role: (r.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: (r.body ?? "").slice(0, MAX_CHARS),
      }));
  } catch {
    return [];
  }
}

/**
 * 今回の往復を残す。
 * ⚠️ 記録に失敗しても回答は返す（develop.md §9）。
 */
export async function appendBotTurn(
  sessionId: number | null,
  o: { question: string; answer: string; sources: BotSource[]; traceId: number | null },
): Promise<void> {
  if (sessionId == null) return;
  const q = (o.question ?? "").trim();
  const a = (o.answer ?? "").trim();
  if (!q && !a) return;
  try {
    await sb.from("bot_messages").insert([
      ...(q ? [{ session_id: sessionId, role: "user", body: q.slice(0, MAX_CHARS), sources: [] }] : []),
      ...(a ? [{
        session_id: sessionId, role: "assistant", body: a.slice(0, MAX_CHARS),
        sources: o.sources ?? [], trace_id: o.traceId ?? null,
      }] : []),
    ]);
    // turn_count は「往復数」。表示・要約の判断に使う（要約自体は Ph4）
    const { data } = await sb.from("bot_sessions")
      .select("turn_count").eq("id", sessionId).maybeSingle();
    const n = ((data as { turn_count?: number } | null)?.turn_count ?? 0) + 1;
    await sb.from("bot_sessions")
      .update({ turn_count: n, last_at: new Date().toISOString() }).eq("id", sessionId);
  } catch {
    // 記録できなくても会話は続けられるべき
  }
}
