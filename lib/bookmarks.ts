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

/** 登録系APIの戻り。`aiPending` は「登録は通ったがAI生成に失敗した」を表す。 */
export interface BookmarkSaveResult {
  ok: boolean;
  /** 登録そのものが失敗したときの理由 */
  error?: string;
  /** 登録は成功したが各項目のAI生成に失敗した */
  aiPending?: boolean;
  /** AI生成が失敗した理由（aiPending のときだけ入る） */
  aiError?: string;
  /** 作られた行のID。分割登録すると複数になる */
  ids?: number[];
}

/** 下見の結果。生成に失敗したら ok:false（呼び出し側は下見なしで登録に進める）。 */
export interface BookmarkPreviewResult {
  ok: boolean;
  error?: string;
  gen?: BookmarkGenResult;
  duplicates?: SimilarBookmark[];
}

interface ApiResponse {
  ok?: boolean; id?: number; ids?: number[];
  aiPending?: boolean; aiError?: string | null;
  gen?: BookmarkGenResult; duplicates?: SimilarBookmark[];
}

/** 下見（action="preview"）の生成結果。 */
export interface BookmarkGenResult {
  expected_question: string;
  keywords: string[];
  formatted_reply: string;
  variables: BookmarkVariable[];
  segments: BookmarkSegment[];
}

/** 下見で見つかった「似ている既存ブックマーク」。 */
export interface SimilarBookmark {
  id: number;
  genre: string;
  expectedQuestion: string;
  formattedReply: string;
  usedCount: number;
  lastUsedAt: string | null;
  score: number;
}

/** /api/bookmarks を叩く共通ヘルパー（失敗時は throw）。 */
async function apiPost(body: unknown): Promise<ApiResponse> {
  const res = await apiFetch("/api/bookmarks", { method: "POST", body });
  const j = (await res.json().catch(() => ({}))) as ApiResponse & { error?: string };
  if (!res.ok) throw new Error(j.error ?? "処理に失敗しました");
  return j;
}

/** ジャンル（AIの検索精度向上のため。先頭がよく使う順） */
export const BOOKMARK_GENRES = [
  "アプローチ", "クレーム", "説明", "申込・手続き",
  "料金・支払い", "予約・日程", "解約・返金", "フォローアップ", "その他",
] as const;
export type BookmarkGenre = (typeof BOOKMARK_GENRES)[number];

/** 公開範囲。広げる方向が不可逆なので、既定は最も狭い ops_only（REQ-032 設計A）。 */
export type PublishScope = "ops_only" | "member" | "public";
export const PUBLISH_SCOPES: { key: PublishScope; label: string; help: string }[] = [
  { key: "ops_only", label: "運営のみ",       help: "返信提案の材料にだけ使われます" },
  { key: "member",   label: "会員まで",       help: "会員のAI相談でも参照されます" },
  { key: "public",   label: "公開ボットまで", help: "未ログインの人にも回答材料として使われます" },
];

/** 承認状態。approved だけが索引に入る（REQ-032 設計E）。 */
export type ReviewStatus = "draft" | "approved" | "archived";

/** formatted_reply の {{変数}} 1つ分。 */
export interface BookmarkVariable { name: string; example: string; kind: string }

/** 原文に複数の話題があったときの分割候補。 */
export interface BookmarkSegment { topic: string; question: string; answer: string }

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
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
  /** 公開範囲（REQ-032）。取り込み時に knowledge_documents.visibility へ写される */
  publishScope: PublishScope;
  /** 承認状態（REQ-032）。approved 以外は検索対象にならない */
  reviewStatus: ReviewStatus;
  /** 差し込み変数（REQ-032） */
  variables: BookmarkVariable[];
  /** 有効期限（YYYY-MM-DD）。null=無期限 */
  validUntil: string | null;
  /** 最終参照日時（日次バッチが ai_traces から積む） */
  lastUsedAt: string | null;
  /** 参照回数（同上） */
  usedCount: number;
}

interface Row {
  id: number; created_at: string;
  source_message_id: number | null; source_conversation_id: number | null;
  source_member_id: number | null; source_message_at: string | null;
  genre: string; original_text: string;
  expected_question: string | null; keywords: string[] | null; formatted_reply: string | null;
  ai_enabled: boolean; ai_pending: boolean;
  folder_id: number | null;
  publish_scope: string | null;
  review_status: string | null;
  variables: BookmarkVariable[] | null;
  valid_until: string | null;
  last_used_at: string | null;
  used_count: number | null;
}

const toBookmark = (r: Row): ChatBookmark => ({
  id: r.id, createdAt: r.created_at,
  sourceMessageId: r.source_message_id, sourceConversationId: r.source_conversation_id,
  sourceMemberId: r.source_member_id, sourceMessageAt: r.source_message_at,
  genre: r.genre, originalText: r.original_text,
  expectedQuestion: r.expected_question ?? "", keywords: r.keywords ?? [],
  formattedReply: r.formatted_reply ?? "", aiEnabled: r.ai_enabled, aiPending: r.ai_pending,
  folderId: r.folder_id ?? null,
  // ⚠️ 列が未適用（マイグレーション前）でも落ちないよう既定値へ倒す。
  //    倒す先は安全側（ops_only）。承認は既存行を消さないため approved 側。
  publishScope: (r.publish_scope as PublishScope) ?? "ops_only",
  reviewStatus: (r.review_status as ReviewStatus) ?? "approved",
  variables: r.variables ?? [],
  validUntil: r.valid_until ?? null,
  lastUsedAt: r.last_used_at ?? null,
  usedCount: r.used_count ?? 0,
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

/** 登録時に共通で渡せるもの（下見の結果を反映するための項目）。 */
export interface BookmarkSaveOptions {
  /** 公開範囲。省略すると ops_only（サーバー側で最も狭い側へ倒す） */
  publishScope?: PublishScope;
  /** 分割して登録するとき。省略・空なら1件で登録する */
  segments?: BookmarkSegment[];
  /** 重複を置き換えるとき、置き換え元のID */
  replaceId?: number;
  /** 下見（previewBookmark）で得た生成結果。渡すとサーバー側で再生成しない */
  gen?: BookmarkGenResult;
}

export interface CreateBookmarkInput extends BookmarkSaveOptions {
  sourceMessageId: number;
  sourceConversationId: number;
  sourceMemberId: number | null;
  sourceMessageAt: string | null;
  originalText: string;
  genre: string;
}

/**
 * 登録前の下見（保存しない）。
 *   ・想定質問・キーワード・案内文・差し込み変数・分割候補をAIが返す
 *   ・似た既存ブックマークがあれば duplicates に入る
 *   ⚠️ 失敗しても登録はできる。呼び出し側はエラーを出したうえで従来どおり登録に進むこと
 *      （下見を必須にすると、AIが落ちている間ブックマークが1件も作れなくなる）。
 */
export async function previewBookmark(
  input: { genre: string; originalText: string },
): Promise<BookmarkPreviewResult> {
  try {
    const r = await apiPost({ action: "preview", ...input });
    return { ok: true, gen: r.gen, duplicates: r.duplicates ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 登録（サーバーでAI自動生成 → 保存）。 */
export async function createBookmark(input: CreateBookmarkInput): Promise<BookmarkSaveResult> {
  try {
    const r = await apiPost({ action: "create", ...input });
    return { ok: true, aiPending: r.aiPending === true, aiError: r.aiError ?? undefined, ids: r.ids ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * 直接登録（トークを経由せず、ジャンル＋原文から作る）。
 *   ・まだ聞かれていない質問を先回りして登録するための入口（取り込み仕様 決定1）。
 *   ・想定質問・キーワード・整形後の案内文はサーバー側でAIが生成する（既存の action="create" と同じ）。
 *   ・登録元トークが無いので source_message_id 等はすべて null になる。
 */
export interface CreateDirectBookmarkInput extends BookmarkSaveOptions {
  genre: string;
  originalText: string;
}
export async function createDirectBookmark(
  input: CreateDirectBookmarkInput,
): Promise<BookmarkSaveResult> {
  try {
    const r = await apiPost({ action: "create", ...input });
    return { ok: true, aiPending: r.aiPending === true, aiError: r.aiError ?? undefined, ids: r.ids ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── LINEトークのブックマーク（共通ナレッジに 'line' チャネルで登録）──
export interface CreateLineBookmarkInput extends BookmarkSaveOptions {
  /** line_messages.id（内部ID） */
  sourceLineMessageId: number;
  sourceMemberId: number | null;
  sourceMessageAt: string | null;
  originalText: string;
  genre: string;
}
export async function createLineBookmark(input: CreateLineBookmarkInput): Promise<BookmarkSaveResult> {
  try {
    const r = await apiPost({ action: "create", channel: "line", ...input });
    return { ok: true, aiPending: r.aiPending === true, aiError: r.aiError ?? undefined, ids: r.ids ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** LINEトークで既にブックマーク済みの line_messages.id 集合。 */
export async function fetchBookmarkedLineMessageIds(): Promise<Set<number>> {
  const { data } = await sb
    .from("chat_bookmarks")
    .select("source_line_message_id")
    .eq("source_channel", "line")
    .eq("is_deleted", false);
  const set = new Set<number>();
  for (const r of (data ?? []) as { source_line_message_id: number | null }[]) {
    if (r.source_line_message_id != null) set.add(r.source_line_message_id);
  }
  return set;
}

/** LINEメッセージ単位でブックマーク解除。 */
export async function deleteBookmarkByLineMessage(lineMessageId: number): Promise<void> {
  await sb.from("chat_bookmarks")
    .update({ is_deleted: true })
    .eq("source_channel", "line")
    .eq("source_line_message_id", lineMessageId);
}

/** AIで各項目を作り直す（原文＋ジャンルから再生成）。 */
export async function regenerateBookmark(id: number): Promise<BookmarkSaveResult> {
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
  publishScope?: PublishScope;
  reviewStatus?: ReviewStatus;
  validUntil?: string | null;
  variables?: BookmarkVariable[];
}

/** 手修正の保存（AI利用トグルもここ）。 */
export async function updateBookmark(id: number, patch: UpdateBookmarkPatch): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.genre !== undefined) row.genre = patch.genre;
  if (patch.expectedQuestion !== undefined) row.expected_question = patch.expectedQuestion;
  if (patch.keywords !== undefined) row.keywords = patch.keywords;
  if (patch.formattedReply !== undefined) row.formatted_reply = patch.formattedReply;
  if (patch.aiEnabled !== undefined) row.ai_enabled = patch.aiEnabled;
  if (patch.publishScope !== undefined) row.publish_scope = patch.publishScope;
  if (patch.reviewStatus !== undefined) row.review_status = patch.reviewStatus;
  if (patch.validUntil !== undefined) row.valid_until = patch.validUntil || null;
  if (patch.variables !== undefined) row.variables = patch.variables;
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

/** ブックマーク（ナレッジ）を別フォルダへ移動する（folderId=null で未分類）。成功で true */
export async function setBookmarkFolder(id: number, folderId: number | null): Promise<boolean> {
  const { error } = await sb.from("chat_bookmarks").update({ folder_id: folderId }).eq("id", id);
  return !error;
}

/** メッセージ単位でブックマーク解除（チャットの「ブックマーク削除」）。 */
export async function deleteBookmarkByMessage(messageId: number): Promise<void> {
  await sb.from("chat_bookmarks").update({ is_deleted: true }).eq("source_message_id", messageId);
}
