// ============================================================
// キーワード自動応答 データアクセス（クライアント安全・Phase 7③）
//   運営RLSで直接 supabase。評価・返信はサーバー（受信Webhook）が行う。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { AutoReplyRule, AutoReplyMatch, RichMessage, FormAction } from "./models";

export function toAutoReply(r: Tables<"line_auto_replies">): AutoReplyRule {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name ?? "",
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    matchType: (["exact", "regex"].includes(r.match_type) ? r.match_type : "partial") as AutoReplyMatch,
    isFallback: r.is_fallback ?? false,
    reply: (r.reply_json as unknown as RichMessage | null) ?? null,
    actions: Array.isArray(r.actions) ? (r.actions as unknown as FormAction[]) : [],
    priority: r.priority ?? 0,
    enabled: r.is_enabled ?? true,
  };
}

export async function fetchAutoReplies(accountId: number | null): Promise<AutoReplyRule[]> {
  if (accountId == null) return [];
  const { data } = await supabase
    .from("line_auto_replies")
    .select("*")
    .eq("account_id", accountId)
    .eq("is_deleted", false)
    .order("priority", { ascending: false })
    .order("id", { ascending: true });
  return (data ?? []).map(toAutoReply);
}

export interface SaveAutoReplyInput {
  id?: number;
  accountId: number;
  name: string;
  keywords: string[];
  matchType: AutoReplyMatch;
  isFallback: boolean;
  reply: RichMessage | null;
  actions: FormAction[];
  priority: number;
  enabled: boolean;
}

export async function saveAutoReply(input: SaveAutoReplyInput): Promise<number | null> {
  const row = {
    account_id: input.accountId,
    name: input.name,
    keywords: input.keywords,
    match_type: input.matchType,
    is_fallback: input.isFallback,
    reply_json: (input.reply ?? null) as unknown as Tables<"line_auto_replies">["reply_json"],
    actions: input.actions as unknown as Tables<"line_auto_replies">["actions"],
    priority: input.priority,
    is_enabled: input.enabled,
    updated_at: new Date().toISOString(),
  };
  if (input.id && input.id > 0) {
    const { error } = await supabase.from("line_auto_replies").update(row).eq("id", input.id);
    return error ? null : input.id;
  }
  const { data, error } = await supabase.from("line_auto_replies").insert(row).select("id").single();
  return error || !data ? null : data.id;
}

export async function deleteAutoReply(id: number): Promise<void> {
  await supabase.from("line_auto_replies").update({ is_deleted: true }).eq("id", id);
}
