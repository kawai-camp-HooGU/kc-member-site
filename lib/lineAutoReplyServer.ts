// ============================================================
// キーワード自動応答 実行（サーバー専用・Phase 7③）
//   受信テキストにルールが一致したら Reply（無料）で返信し、アクションを発火する。
//   ・返信は replyToken（無料・受信直後のみ有効）。無ければ返信はスキップ。
//   ・アクションは既存基盤（会員=runActions / 未連携友だち=applyAttrActionsToFriend）。
//   ⚠️ 受信Webhook から呼ぶ。例外は投げない（本流を止めない）。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { replyMessages } from "./lineClient";
import { toLineMessages, richMessageSummary } from "./lineRichMessage";
import { getAccountLiffId } from "./lineBroadcastServer";
import { runActions, applyAttrActionsToFriend } from "./actionsServer";
import { errMessage } from "./errors";
import type { RichMessage, FormAction } from "./models";

interface RuleRow {
  id: number; keywords: string[]; match_type: string; is_fallback: boolean;
  reply_json: unknown; actions: unknown; priority: number;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

function keywordHit(text: string, keywords: string[], matchType: string): boolean {
  const t = norm(text);
  if (!t) return false;
  for (const kwRaw of keywords) {
    const kw = (kwRaw ?? "").trim();
    if (!kw) continue;
    if (matchType === "exact") { if (t === norm(kw)) return true; }
    else if (matchType === "regex") { try { if (new RegExp(kw, "i").test(text)) return true; } catch { /* 無効な正規表現は無視 */ } }
    else { if (t.includes(norm(kw))) return true; } // partial
  }
  return false;
}

/**
 * 受信テキストを評価し、一致ルールがあれば返信＋アクション発火。返信したら true。
 */
export async function evaluateAndReply(
  accountId: number, accessToken: string, replyToken: string | null, friendId: number, text: string
): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("line_auto_replies")
      .select("id, keywords, match_type, is_fallback, reply_json, actions, priority")
      .eq("account_id", accountId).eq("is_deleted", false).eq("is_enabled", true)
      .order("priority", { ascending: false }).order("id", { ascending: true });
    const rules = (data ?? []) as RuleRow[];
    if (rules.length === 0) return false;

    // キーワード一致を優先し、無ければフォールバック。
    let matched = rules.find((r) => !r.is_fallback && keywordHit(text, r.keywords ?? [], r.match_type));
    if (!matched) matched = rules.find((r) => r.is_fallback);
    if (!matched) return false;

    // 返信（リッチメッセージ）
    let replied = false;
    const reply = (matched.reply_json as RichMessage | null) ?? null;
    if (reply && replyToken) {
      const liffId = await getAccountLiffId(accountId);
      const messages = toLineMessages(reply, liffId);
      if (messages.length) {
        await replyMessages(accessToken, replyToken, messages);
        replied = true;
        // 履歴（out）に残す（並び順は動かさない＝last_message_at は触らない）
        await supabaseAdmin.from("line_messages").insert({
          account_id: accountId, friend_id: friendId, direction: "out", msg_type: "text",
          body: richMessageSummary(reply), send_kind: "reply", sent_by: null,
          created_at: new Date().toISOString(),
        });
      }
    }

    // アクション発火（会員=runActions / 未連携友だち=applyAttrActionsToFriend）
    const actions = (Array.isArray(matched.actions) ? matched.actions : []) as FormAction[];
    if (actions.length) {
      const { data: f } = await supabaseAdmin
        .from("line_friends").select("member_id").eq("id", friendId).maybeSingle();
      if (f?.member_id != null) await runActions(actions, f.member_id);
      else await applyAttrActionsToFriend(friendId, actions);
    }

    return replied;
  } catch (e) {
    console.error("evaluateAndReply:", accountId, errMessage(e));
    return false;
  }
}
