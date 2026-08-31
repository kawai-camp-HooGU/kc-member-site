// ============================================================
// クライアント → /api/ai/* の呼び出し口
//   認可ヘッダは apiFetch が付ける。エラーは日本語メッセージで throw。
// ============================================================
import { apiFetch } from "./apiClient";
import type {
  AiConsultReq, AiConsultRes,
  ReplySuggestReq, ReplySuggestRes, LineReplySuggestReq,
  ReviewReq, ReviewRes,
  HtmlGenerateReq, HtmlGenerateRes,
  DoorGenerateReq, DoorGenerateRes,
  BroadcastDraftReq, BroadcastDraftRes,
  BroadcastCheckReq, BroadcastCheckRes,
  DataSearchReq, DataSearchRes,
  AiPromptItem, AiPromptPartItem, AiPromptSaveReq, AiPromptPreviewReq, AiPromptPreviewRes,
  AiTraceRow, AiTraceDetail, AiTraceState, AiUsageSummaryRow,
  AiConsultThread, AiConsultTurn,
  AiFeedbackReq,
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

/** ② 返信提案（LINEトーク版・Phase 3） */
export const aiLineReplySuggest = (req: LineReplySuggestReq) =>
  post<LineReplySuggestReq, ReplySuggestRes>("/api/ai/line-reply-suggest", req);

/** ③ 添削 */
export const aiReview = (req: ReviewReq) =>
  post<ReviewReq, ReviewRes>("/api/ai/review", req);

/** ④ HTML生成 */
export const aiHtmlGenerate = (req: HtmlGenerateReq) =>
  post<HtmlGenerateReq, HtmlGenerateRes>("/api/ai/html-generate", req);

/** ⑧ 扉ページHTML生成（④とは許可タグ・サニタイズが異なる） */
export const aiDoorGenerate = (req: DoorGenerateReq) =>
  post<DoorGenerateReq, DoorGenerateRes>("/api/ai/door-generate", req);

/** ⑤ 配信原稿生成 */
export const aiBroadcastDraft = (req: BroadcastDraftReq) =>
  post<BroadcastDraftReq, BroadcastDraftRes>("/api/ai/broadcast-draft", req);

/** ⑤ 配信前チェック */
export const aiBroadcastCheck = (req: BroadcastCheckReq) =>
  post<BroadcastCheckReq, BroadcastCheckRes>("/api/ai/broadcast-check", req);

/** ⑥ データ検索（呼び出し画面の scope に応じてサーバーが参照範囲を切替） */
export const aiDataSearch = (req: DataSearchReq) =>
  post<DataSearchReq, DataSearchRes>("/api/ai/data-search", req);

// ── ①AI相談の過去スレッド（B-4）──────────────────────────────
/** 自分のスレッド一覧（新しい順）。取れなくても画面は動かすので空配列に倒す。 */
export async function aiConsultThreads(): Promise<AiConsultThread[]> {
  try {
    const res = await apiFetch("/api/ai/consult-threads", { method: "GET" });
    if (!res.ok) return [];
    const j = (await res.json()) as { threads?: AiConsultThread[] };
    return j.threads ?? [];
  } catch {
    return [];
  }
}

/** 1スレッドの発言（古い順）。失敗は throw する（開けなかったことを伝える）。 */
export async function aiConsultThread(id: number): Promise<AiConsultTurn[]> {
  const res = await apiFetch(`/api/ai/consult-threads?id=${id}`, { method: "GET" });
  const j = (await res.json().catch(() => ({}))) as { turns?: AiConsultTurn[]; error?: string };
  if (!res.ok) throw new Error(j.error ?? "スレッドを開けませんでした");
  return j.turns ?? [];
}

/** 回答への評価（A-8）。未ログインの公開ボットからも押せる。 */
export const aiFeedback = (req: AiFeedbackReq) =>
  post<AiFeedbackReq, { ok: boolean }>("/api/ai/feedback", req);

// ── プロンプト管理（管理者のみ）──────────────────────────────
/** 全機能のプロンプト（役割＋固定契約）と共通パーツを取得 */
export async function aiPromptList(): Promise<{ items: AiPromptItem[]; parts: AiPromptPartItem[] }> {
  const res = await apiFetch("/api/admin/ai-prompts", { method: "GET" });
  const json = (await res.json()) as
    { items?: AiPromptItem[]; parts?: AiPromptPartItem[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "プロンプトの取得に失敗しました");
  return { items: json.items ?? [], parts: json.parts ?? [] };
}

/** 1機能の役割・方針、または1つの共通パーツを保存 */
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

// ── 回答トレース（管理者のみ）──────────────────────────────
async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "GET" });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* noop */ }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `取得に失敗しました (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}

export interface AiTraceListRes { rows: AiTraceRow[]; total: number; days: number; limit: number }

/** 一覧（既定は当日・100件） */
export function aiTraceList(
  opts: { days?: number; feature?: string | null; state?: AiTraceState | null; limit?: number } = {},
): Promise<AiTraceListRes> {
  const q = new URLSearchParams({ mode: "list" });
  if (opts.days) q.set("days", String(opts.days));
  if (opts.feature) q.set("feature", opts.feature);
  if (opts.state) q.set("state", opts.state);
  if (opts.limit) q.set("limit", String(opts.limit));
  return getJson<AiTraceListRes>(`/api/admin/ai-traces?${q.toString()}`);
}

/** 1件の全文（system / messages / 検索の採点） */
export async function aiTraceDetail(id: number): Promise<AiTraceDetail> {
  const r = await getJson<{ detail: AiTraceDetail }>(`/api/admin/ai-traces?mode=detail&id=${id}`);
  return r.detail;
}

export interface AiUsageSummaryRes {
  rows: AiUsageSummaryRow[];
  days: number;
  /** false のあいだは金額を表示しない（単価が未設定） */
  priceConfigured: boolean;
}

/** 機能別の利用状況 */
export function aiUsageSummary(days = 30): Promise<AiUsageSummaryRes> {
  return getJson<AiUsageSummaryRes>(`/api/admin/ai-traces?mode=summary&days=${days}`);
}
