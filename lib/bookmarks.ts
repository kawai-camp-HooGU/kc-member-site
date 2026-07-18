// ============================================================
// トークのブックマーク（AIナレッジ）：クライアント側 CRUD
//   ・登録／AI再生成 … サーバー（/api/bookmarks）でAI生成してから保存
//   ・一覧／更新／削除／AI利用トグル … RLS(運営)で直接 supabase
//   ⚠️ chat_bookmarks は生成型(database.types)に無いためクライアントをキャストして扱う。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";

const sb = supabase as unknown as SupabaseClient;

/** /api/bookmarks を叩く共通ヘルパー（失敗時は throw）。 */
async function apiPost(body: unknown): Promise<void> {
  const res = await apiFetch("/api/bookmarks", { method: "POST", body });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? "処理に失敗しました");
  }
}

/** ジャンル（AIの検索精度向上のため。先頭がよく使う順） */
export const BOOKMARK_GENRES = [
  "アプローチ", "クレーム", "説明", "申込・手続き",
  "料金・支払い", "予約・日程", "解約・返金", "フォローアップ", "その他",
] as const;
export type BookmarkGenre = (typeof BOOKMARK_GENRES)[number];

export interface ChatBookmark {
  id: number;
  createdAt: string;
  sourceMessageId: number | null;
  sourceConversationId: number | null;
  sourceMemberId: number | null;
  sourceMessageAt: string | null;
  genre: string;
  originalText: string;
  expectedQuestion: string;
  keywords: string[];
  formattedReply: string;
  aiEnabled: boolean;
  aiPending: boolean;
}

interface Row {
  id: number; created_at: string;
  source_message_id: number | null; source_conversation_id: number | null;
  source_member_id: number | null; source_message_at: string | null;
  genre: string; original_text: string;
  expected_question: string | null; keywords: string[] | null; formatted_reply: string | null;
  ai_enabled: boolean; ai_pending: boolean;
}

const toBookmark = (r: Row): ChatBookmark => ({
  id: r.id, createdAt: r.created_at,
  sourceMessageId: r.source_message_id, sourceConversationId: r.source_conversation_id,
  sourceMemberId: r.source_member_id, sourceMessageAt: r.source_message_at,
  genre: r.genre, originalText: r.original_text,
  expectedQuestion: r.expected_question ?? "", keywords: r.keywords ?? [],
  formattedReply: r.formatted_reply ?? "", aiEnabled: r.ai_enabled, aiPending: r.ai_pending,
});

/** 一覧（未削除・新しい順） */
export async function fetchBookmarks(): Promise<ChatBookmark[]> {
  const { data, error } = await sb
    .from("chat_bookmarks").select("*")
    .eq("is_deleted", false).order("created_at", { ascending: false });
  if (error) { console.error("fetchBookmarks", error); return []; }
  return (data as Row[] ?? []).map(toBookmark);
}

/** 会話内でブックマーク済みのメッセージID集合（チャットの★表示用） */
export async function fetchBookmarkedMessageIds(conversationId: number): Promise<Set<number>> {
  const { data } = await sb
    .from("chat_bookmarks").select("source_message_id")
    .eq("source_conversation_id", conversationId).eq("is_deleted", false);
  const set = new Set<number>();
  (data as { source_message_id: number | null }[] ?? []).forEach((r) => {
    if (r.source_message_id != null) set.add(r.source_message_id);
  });
  return set;
}

export interface CreateBookmarkInput {
  sourceMessageId: number;
  sourceConversationId: number;
  sourceMemberId: number | null;
  sourceMessageAt: string | null;
  originalText: string;
  genre: string;
}

/** 登録（サーバーでAI自動生成 → 保存）。 */
export async function createBookmark(input: CreateBookmarkInput): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiPost({ action: "create", ...input });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** AIで各項目を作り直す（原文＋ジャンルから再生成）。 */
export async function regenerateBookmark(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiPost({ action: "regenerate", id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface UpdateBookmarkPatch {
  genre?: string;
  expectedQuestion?: string;
  keywords?: string[];
  formattedReply?: string;
  aiEnabled?: boolean;
}

/** 手修正の保存（AI利用トグルもここ）。 */
export async function updateBookmark(id: number, patch: UpdateBookmarkPatch): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.genre !== undefined) row.genre = patch.genre;
  if (patch.expectedQuestion !== undefined) row.expected_question = patch.expectedQuestion;
  if (patch.keywords !== undefined) row.keywords = patch.keywords;
  if (patch.formattedReply !== undefined) row.formatted_reply = patch.formattedReply;
  if (patch.aiEnabled !== undefined) row.ai_enabled = patch.aiEnabled;
  // 手修正が入ったら「要確認」を解除
  if (patch.expectedQuestion !== undefined || patch.formattedReply !== undefined || patch.keywords !== undefined) {
    row.ai_pending = false;
  }
  const { error } = await sb.from("chat_bookmarks").update(row).eq("id", id);
  if (error) { console.error("updateBookmark", error); return false; }
  return true;
}

export async function deleteBookmark(id: number): Promise<void> {
  await sb.from("chat_bookmarks").update({ is_deleted: true }).eq("id", id);
}

/** メッセージ単位でブックマーク解除（チャットの「ブックマーク削除」）。 */
export async function deleteBookmarkByMessage(messageId: number): Promise<void> {
  await sb.from("chat_bookmarks").update({ is_deleted: true }).eq("source_message_id", messageId);
}
