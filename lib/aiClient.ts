// ============================================================
// クライアント → /api/ai/* の呼び出し口
//   認可ヘッダは apiFetch が付ける。エラーは日本語メッセージで throw。
// ============================================================
import { apiFetch } from "./apiClient";
import type {
  AiConsultReq, AiConsultRes,
  ReplySuggestReq, ReplySuggestRes,
  ReviewReq, ReviewRes,
  HtmlGenerateReq, HtmlGenerateRes,
  BroadcastDraftReq, BroadcastDraftRes,
  BroadcastCheckReq, BroadcastCheckRes,
  DataSearchReq, DataSearchRes,
  AiPromptItem, AiPromptSaveReq, AiPromptPreviewReq, AiPromptPreviewRes,
} from "./ai/types";

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await apiFetch(path, { method: "POST", body });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* noop */ }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `AIの呼び出しに失敗しました (${res.status})`;
    throw new Error(msg);
  }
  return json as TRes;
}

/** ① メンバーAI相談 */
export const aiConsult = (req: AiConsultReq) =>
  post<AiConsultReq, AiConsultRes>("/api/ai/member-consult", req);

/** ① 事務局へ引き継ぎ済みを記録（送信自体は本人が行う） */
export const aiEscalate = (aiConversationId: number) =>
  post<{ aiConversationId: number }, { conversationId: number | null }>("/api/ai/escalate", { aiConversationId });

/** ② 返信提案 / 相談 */
export const aiReplySuggest = (req: ReplySuggestReq) =>
  post<ReplySuggestReq, ReplySuggestRes>("/api/ai/reply-suggest", req);

/** ③ 添削 */
export const aiReview = (req: ReviewReq) =>
  post<ReviewReq, ReviewRes>("/api/ai/review", req);

/** ④ HTML生成 */
export const aiHtmlGenerate = (req: HtmlGenerateReq) =>
  post<HtmlGenerateReq, HtmlGenerateRes>("/api/ai/html-generate", req);

/** ⑤ 配信原稿生成 */
export const aiBroadcastDraft = (req: BroadcastDraftReq) =>
  post<BroadcastDraftReq, BroadcastDraftRes>("/api/ai/broadcast-draft", req);

/** ⑤ 配信前チェック */
export const aiBroadcastCheck = (req: BroadcastCheckReq) =>
  post<BroadcastCheckReq, BroadcastCheckRes>("/api/ai/broadcast-check", req);

/** ⑥ データ検索（呼び出し画面の scope に応じてサーバーが参照範囲を切替） */
export const aiDataSearch = (req: DataSearchReq) =>
  post<DataSearchReq, DataSearchRes>("/api/ai/data-search", req);

// ── プロンプト管理（管理者のみ）──────────────────────────────
/** 全機能のプロンプト（役割＋固定契約）を取得 */
export async function aiPromptList(): Promise<AiPromptItem[]> {
  const res = await apiFetch("/api/admin/ai-prompts", { method: "GET" });
  const json = (await res.json()) as { items?: AiPromptItem[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "プロンプトの取得に失敗しました");
  return json.items ?? [];
}

/** 1機能の役割・方針を保存 */
export async function aiPromptSave(req: AiPromptSaveReq): Promise<void> {
  const res = await apiFetch("/api/admin/ai-prompts", { method: "PUT", body: req });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error ?? "保存に失敗しました");
  }
}

/** 保存前プレビュー（試走） */
export const aiPromptPreview = (req: AiPromptPreviewReq) =>
  post<AiPromptPreviewReq, AiPromptPreviewRes>("/api/admin/ai-prompts", req);

/** 既存：会話要約（AiPanel のクイック指示から使う） */
export async function aiSummarize(conversationId: number): Promise<string> {
  const res = await apiFetch("/api/chat/summarize", { method: "POST", body: { conversationId } });
  const json = (await res.json()) as { summary?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? "要約に失敗しました");
  return json.summary ?? "";
}
