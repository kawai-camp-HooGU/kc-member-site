// ============================================================
// 公開問い合わせボット サーバーロジック（service_role 専用）
//
//   ・知識源は既存 public.chat_bookmarks（ai_enabled=true）だけ（フェーズA）。
//   ・索引 bot_bm_index を再生成し、ハイブリッド検索 → Claude 生成する。
//   ・回数/スコープ/体験版のゲートもここで判定する。
//   ⚠️ ここは service_role で RLS をバイパスするため、公開へ出す値は限定する
//      （絶対パス・内部status・顧客情報・source_* は返さない/ログしない）。
// ============================================================
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { HttpError } from "../authz";
import { callClaude } from "../ai/claude";
import { embedText, toVectorLiteral } from "./embed";
import { retrieveKnowledge } from "../ai/knowledge/retrieveServer";
import { loadStyleGuide, loadApprovedPersona } from "../ai/knowledge/personaServer";
import type { BotEntry, BotSource } from "./types";

// chat_bookmarks / bot_* は生成型(database.types)に無いためキャストして扱う（brand.md 準拠）。
const sb = supabaseAdmin as unknown as SupabaseClient;

// ── ポリシー ──────────────────────────────────────────────────
export interface BotPolicy {
  entry: BotEntry;
  daily_limit: number;
  scope_genres: string[];
  web_search: "off" | "assist" | "always";
  max_tokens: number;
  enabled: boolean;
}

const FALLBACK_POLICY: Record<BotEntry, BotPolicy> = {
  anon:   { entry: "anon",   daily_limit: 3,  scope_genres: [], web_search: "off",    max_tokens: 700, enabled: true },
  member: { entry: "member", daily_limit: 50, scope_genres: [], web_search: "assist", max_tokens: 700, enabled: true },
  trial:  { entry: "trial",  daily_limit: 10, scope_genres: [], web_search: "off",    max_tokens: 700, enabled: true },
};

export async function loadPolicy(entry: BotEntry): Promise<BotPolicy> {
  const { data } = await sb.from("bot_policies").select("*").eq("entry", entry).maybeSingle();
  if (!data) return FALLBACK_POLICY[entry];
  const r = data as Partial<BotPolicy>;
  return {
    entry,
    daily_limit: r.daily_limit ?? FALLBACK_POLICY[entry].daily_limit,
    scope_genres: r.scope_genres ?? [],
    web_search: (r.web_search ?? "off") as BotPolicy["web_search"],
    max_tokens: r.max_tokens ?? 700,
    enabled: r.enabled ?? true,
  };
}

// ── 体験版リンク ──────────────────────────────────────────────
export interface ShareLink {
  token: string;
  expires_at: string | null;
  total_limit: number;
  used_count: number;
  passcode: string | null;
  web_search: boolean;
  revoked: boolean;
}

export async function loadShareLink(token: string): Promise<ShareLink | null> {
  const { data } = await sb.from("bot_share_links").select("*").eq("token", token).maybeSingle();
  return (data as ShareLink | null) ?? null;
}

/** 体験版リンクの有効性を検証（期限・失効・累計）。無効なら HttpError。 */
export function assertShareUsable(link: ShareLink | null): asserts link is ShareLink {
  if (!link || link.revoked) throw new HttpError(403, "このリンクは利用できません。");
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    throw new HttpError(403, "この体験版リンクは有効期限が切れています。");
  }
  if (link.used_count >= link.total_limit) {
    throw new HttpError(429, "体験版の利用回数が終了しました。");
  }
}

// ── 回数ゲート ────────────────────────────────────────────────
/** Asia/Tokyo の今日（YYYY-MM-DD） */
function todayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** 端末単位のキー（IP+UAのハッシュ。個人特定はしない）。 */
export function subjectKeyFor(entry: BotEntry, opts: { memberId?: number | null; token?: string | null; ip?: string; ua?: string }): string {
  if (entry === "member" && opts.memberId != null) return `m:${opts.memberId}`;
  if (entry === "trial" && opts.token) return `t:${opts.token}`;
  const raw = `${opts.ip ?? ""}|${opts.ua ?? ""}`;
  return `a:${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

/**
 * anon / member の当日回数を +1 して残数を返す。上限超過は HttpError(429)。
 * trial は share_links.used_count で管理するため別処理（bumpShareUsage）。
 */
export async function bumpDailyUsage(entry: BotEntry, subjectKey: string, dailyLimit: number): Promise<number> {
  const day = todayJst();
  const { data: row } = await sb
    .from("bot_usage")
    .select("id, count")
    .eq("entry", entry).eq("subject_key", subjectKey).eq("day", day)
    .maybeSingle();

  const used = (row as { count?: number } | null)?.count ?? 0;
  if (used >= dailyLimit) {
    throw new HttpError(429, `本日の利用上限（${dailyLimit}回）に達しました。`);
  }
  if (row) {
    await sb.from("bot_usage").update({ count: used + 1, updated_at: new Date().toISOString() })
      .eq("id", (row as { id: number }).id);
  } else {
    await sb.from("bot_usage").insert({ entry, subject_key: subjectKey, day, count: 1 });
  }
  return Math.max(0, dailyLimit - used - 1);
}

/** trial の累計を +1 して残数を返す。 */
export async function bumpShareUsage(link: ShareLink): Promise<number> {
  const next = link.used_count + 1;
  await sb.from("bot_share_links").update({ used_count: next }).eq("token", link.token);
  return Math.max(0, link.total_limit - next);
}

// ── スコープ判定（この質問だけ答える）────────────────────────
/**
 * scopeGenres が空なら常に許可。指定があれば軽量モデルで質問を分類し、
 * 対象ジャンル内かを返す。分類失敗時は fail-open（知識自体がブックマークに限定されているため）。
 */
export async function classifyInScope(message: string, scopeGenres: string[]): Promise<boolean> {
  if (!scopeGenres.length) return true;
  try {
    const answer = await callClaude({
      feature: "bot_public",
      system: "あなたは分類器です。ユーザーの質問が、次のジャンルのどれに該当するかを1つだけ返します。" +
        `該当なしは「対象外」。ジャンル: ${scopeGenres.join(" / ")}。出力はジャンル名のみ。`,
      messages: [{ role: "user", content: (message ?? "").slice(0, 500) }],
      maxTokens: 16,
      temperature: 0,
      callerMemberId: null,
    });
    const label = (answer ?? "").trim();
    return scopeGenres.some((g) => label.includes(g));
  } catch {
    return true; // fail-open
  }
}

// ── ハイブリッド検索 ──────────────────────────────────────────
export interface RetrievedRow { bookmark_id: number; genre: string; answer_text: string; score: number }

export async function retrieveContext(message: string, scopeGenres: string[]): Promise<RetrievedRow[]> {
  const emb = await embedText(message);
  const { data, error } = await sb.rpc("bot_hybrid_search", {
    q: message.slice(0, 500),
    q_emb: toVectorLiteral(emb),
    cats: scopeGenres.length ? scopeGenres : null,
    k: 6,
  });
  if (error) throw new HttpError(502, "検索に失敗しました");
  const rows = (data as RetrievedRow[] | null) ?? [];
  return rows.filter((r) => (r.score ?? 0) > 0);
}

// ── Web検索（外部情報）──────────────────────────────────────
//   ⚠️ フェーズAでは未接続。プラグイン導入まで空配列を返す（プランは実装案v3参照）。
//   接続時も speaker=external として扱い、ペルソナ事実へ混ぜない。
export async function searchWeb(_message: string): Promise<{ url: string; title: string; snippet: string }[]> {
  return [];
}

// ── 回答生成 ──────────────────────────────────────────────────
const SYSTEM_PROMPT =
  "あなたはKAWAI-CAMPの案内アシスタントです。以下の「ナレッジ」だけを根拠に回答してください。\n" +
  "・結論を先に、短く、具体的に。最初の1〜2文で答える。\n" +
  "・ナレッジに無いことは断定しない。分からない場合は無理に答えず、事務局への問い合わせを案内する。\n" +
  "・価格・約束・契約・申込の確定はしない。案内に留め、最終手続きは公式ページ/事務局へ誘導する。\n" +
  "・過剰な改行や連続絵文字、売り込みは避ける。\n" +
  "・内部情報（管理用ID・内部メモ・URL以外の内部パス等）は出力しない。";

const NO_HIT_ANSWER =
  "その内容については、こちらではお答えできる情報が見つかりませんでした。" +
  "お手数ですが、事務局までお問い合わせください。";

export interface GenerateInput {
  message: string;
  /** 整形済みナレッジ文脈（[bm:...] や [note] … の連結） */
  knowledge: string;
  /** ナレッジ由来の出典（bookmark or doc） */
  sources: BotSource[];
  web: { url: string; title: string; snippet: string }[];
  maxTokens: number;
  memberId: number | null;
  /** 文体ガイド（persona / フェーズB）。あれば system に付与。 */
  styleGuide?: string;
}

export interface GenerateResult { answer: string; sources: BotSource[] }

export async function generateAnswer(input: GenerateInput): Promise<GenerateResult> {
  const { message, knowledge, sources, web, maxTokens, memberId, styleGuide } = input;

  // 該当なし かつ 外部情報なし → コスト節約のため定型で返す
  if (!knowledge.trim() && web.length === 0) {
    return { answer: NO_HIT_ANSWER, sources: [] };
  }

  const system = styleGuide && styleGuide.trim()
    ? `${SYSTEM_PROMPT}\n【文体（KAWAIらしさ）】${styleGuide}`
    : SYSTEM_PROMPT;

  const external = web.length
    ? "\n\n【外部情報（KAWAI本人の見解ではありません。最新情報の可能性があり断定しない）】\n" +
      web.map((w) => `- ${w.title}: ${w.snippet}（${w.url}）`).join("\n")
    : "";

  const user =
    `【ナレッジ】\n${knowledge || "（該当なし）"}${external}\n\n` +
    `【質問】\n${(message ?? "").slice(0, 1000)}`;

  const answer = await callClaude({
    feature: "bot_public",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens,
    temperature: 0.3,
    callerMemberId: memberId,
  });

  const allSources: BotSource[] = [
    ...sources,
    ...web.map((w): BotSource => ({ type: "web", url: w.url, title: w.title })),
  ];
  return { answer: answer || NO_HIT_ANSWER, sources: allSources };
}

// ── ナレッジ取得（フラグで Phase A / B を切替）────────────────
//   AI_KAWAI_KNOWLEDGE_ENABLED=true … note/X＋bookmark を統合した knowledge_chunks を参照。
//   未設定/false             … 従来どおり bot_bm_index（ブックマークのみ）。
export async function retrieveForBot(
  message: string, scopeGenres: string[],
): Promise<{ knowledge: string; sources: BotSource[]; styleGuide: string }> {
  if (process.env.AI_KAWAI_KNOWLEDGE_ENABLED === "true") {
    const [krows, styleGuide, personaBlock] = await Promise.all([
      retrieveKnowledge(message, 8),
      loadStyleGuide(),
      loadApprovedPersona(),
    ]);
    const body = krows
      .map((r) => `[${r.sourceType}] ${r.title ?? ""}\n${(r.text ?? "").slice(0, 500)}`)
      .join("\n\n");
    const knowledge = personaBlock ? `${personaBlock}\n\n${body}` : body;
    const sources: BotSource[] = krows.map((r) => ({
      type: "doc",
      docType: r.sourceType,
      title: r.title ?? (r.sourceType === "chat_bookmark" ? "ブックマーク" : "資料"),
      url: r.url,
    }));
    return { knowledge, sources, styleGuide };
  }
  const rows = await retrieveContext(message, scopeGenres);
  const knowledge = rows
    .map((r) => `[bm:${r.bookmark_id}][${r.genre}] ${(r.answer_text ?? "").slice(0, 600)}`)
    .join("\n\n");
  const sources: BotSource[] = rows.map((r) => ({ type: "bookmark", id: r.bookmark_id, genre: r.genre }));
  return { knowledge, sources, styleGuide: "" };
}

// ── 監査ログ ──────────────────────────────────────────────────
export async function logPublic(row: {
  entry: BotEntry;
  subject_key: string;
  question: string;
  matched_bookmark_ids: number[];
  used_web: boolean;
  refused: boolean;
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  try {
    await sb.from("bot_public_logs").insert({
      entry: row.entry,
      subject_key: row.subject_key,
      question: (row.question ?? "").slice(0, 2000),
      matched_bookmark_ids: row.matched_bookmark_ids,
      used_web: row.used_web,
      refused: row.refused,
      ok: row.ok,
      error: row.error ?? null,
    });
  } catch {
    /* ログ失敗で本処理は止めない */
  }
}

// ── 索引の再生成（chat_bookmarks → bot_bm_index）───────────────
interface BookmarkRow {
  id: number; genre: string | null;
  expected_question: string | null; keywords: string[] | null;
  formatted_reply: string | null; original_text: string | null;
}

function buildRetrievalText(b: BookmarkRow): string {
  return [b.expected_question ?? "", (b.keywords ?? []).join(" "), b.original_text ?? ""]
    .map((s) => s.trim()).filter(Boolean).join("\n");
}
function buildAnswerText(b: BookmarkRow): string {
  const t = (b.formatted_reply ?? "").trim() || (b.original_text ?? "").trim();
  return t.slice(0, 1200);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface RebuildResult { scanned: number; upserted: number; unchanged: number; pruned: number }

/** ai_enabled=true のブックマークだけを索引化する。content_hash 不変ならスキップ。 */
export async function rebuildBotIndex(): Promise<RebuildResult> {
  const { data } = await sb
    .from("chat_bookmarks")
    .select("id, genre, expected_question, keywords, formatted_reply, original_text")
    .eq("ai_enabled", true)
    .eq("is_deleted", false);

  const rows = (data as BookmarkRow[] | null) ?? [];

  const { data: idxData } = await sb.from("bot_bm_index").select("bookmark_id, content_hash");
  const existing = new Map<number, string>();
  for (const r of (idxData as { bookmark_id: number; content_hash: string }[] | null) ?? []) {
    existing.set(r.bookmark_id, r.content_hash);
  }

  let upserted = 0;
  let unchanged = 0;
  const keep = new Set<number>();

  for (const b of rows) {
    keep.add(b.id);
    const retrieval = buildRetrievalText(b);
    const hash = sha256(`${b.genre ?? ""}${retrieval}`);
    if (existing.get(b.id) === hash) { unchanged++; continue; }

    const emb = await embedText(retrieval);
    await sb.rpc("bot_bm_upsert", {
      p_id: b.id,
      p_genre: b.genre ?? "",
      p_retrieval: retrieval,
      p_answer: buildAnswerText(b),
      p_emb: toVectorLiteral(emb),
      p_hash: hash,
    });
    upserted++;
  }

  // 対象外になった（ai_enabled=false / 論理削除）索引を除去
  let pruned = 0;
  const staleIds = [...existing.keys()].filter((id) => !keep.has(id));
  if (staleIds.length) {
    await sb.from("bot_bm_index").delete().in("bookmark_id", staleIds);
    pruned = staleIds.length;
  }

  return { scanned: rows.length, upserted, unchanged, pruned };
}
