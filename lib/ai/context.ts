// ============================================================
// AIへ渡すコンテキストの収集（サーバー専用）
//
//   重要: コンテキストは必ずサーバー側で組み立てる。
//   クライアントから受け取った本文をそのままプロンプトに入れない
//   （改ざん・越権参照を防ぐ）。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { embedText, toVectorLiteral } from "../bot/embed";
import { loadSourceIndex, sourceLabeler } from "../sourcesServer";
import { loadStaffRoleKeys } from "../rolesServer";
import { matchSource } from "../sources";
import type { PublishMode, SourceCategory } from "../models";
import { maskText } from "./pii";
import { retrieveKnowledge } from "./knowledge/retrieveServer";
import type { AiCitation, BcTarget, SearchScope } from "./types";

// ── デリミタ ─────────────────────────────────────────────────
//   実体は lib/ai-core/guardrails/delimiter.ts へ移設（Ph3）。
//   既存の import（context から wrap を取る）を壊さないよう再輸出する。
import { wrap } from "../ai-core/guardrails/delimiter";
export { wrap };

// ── 属性 ──────────────────────────────────────────────────────
export interface AttrTree {
  /** attribute_id → 表示名 */
  name: Map<number, string>;
  /** attribute_id → 自分＋祖先すべての id 集合 */
  ancestors: Map<number, Set<number>>;
}

export async function loadAttrTree(): Promise<AttrTree> {
  const { data } = await supabaseAdmin
    .from("attributes")
    .select("id, name, parent_id")
    .eq("is_deleted", false);

  const parent = new Map<number, number | null>();
  const name = new Map<number, string>();
  for (const r of data ?? []) {
    parent.set(r.id, r.parent_id);
    name.set(r.id, r.name);
  }
  const ancestors = new Map<number, Set<number>>();
  for (const id of parent.keys()) {
    const set = new Set<number>();
    let cur: number | null | undefined = id;
    let guard = 0;
    while (cur != null && guard++ < 10) {
      set.add(cur);
      cur = parent.get(cur) ?? null;
    }
    ancestors.set(id, set);
  }
  return { name, ancestors };
}

/** 属性ラベル（末端名）を並べる */
export function attrNames(tree: AttrTree, ids: number[]): string[] {
  return ids.map((id) => tree.name.get(id) ?? `#${id}`);
}

/** メンバーの属性が公開対象（属性＋モード）を満たすか。lib/contents.ts の canView と同じ判定。 */
export function canView(
  targetAttrIds: number[],
  mode: PublishMode,
  memberAttrIds: number[],
  tree: AttrTree,
): boolean {
  if (targetAttrIds.length === 0) return true;
  const covers = (t: number) => memberAttrIds.some((aid) => tree.ancestors.get(aid)?.has(t));
  const some = targetAttrIds.some(covers);
  const every = targetAttrIds.every(covers);
  switch (mode) {
    case "any": return some;
    case "all": return every;
    case "exany": return !some;
    case "exall": return !every;
    default: return true;
  }
}

const asMode = (v: string | null | undefined): PublishMode =>
  v === "all" || v === "exany" || v === "exall" ? v : "any";

// ── メンバー ──────────────────────────────────────────────────
export interface MemberProfile {
  id: number;
  name: string;
  role: string;
  company: string;
  source: string;
  prefecture: string;
  createdAt: string;
  attrIds: number[];
  attrLabels: string[];
  memos: string[];
}

export async function loadMemberAttrIds(memberId: number): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("member_attributes")
    .select("attribute_id")
    .eq("member_id", memberId);
  return (data ?? []).map((r) => r.attribute_id);
}

export async function loadMemberProfile(memberId: number, tree: AttrTree): Promise<MemberProfile | null> {
  const { data: m } = await supabaseAdmin
    .from("members")
    .select("id, name, role, company, source_id, prefecture, created_at")
    .eq("id", memberId)
    .maybeSingle();
  if (!m) return null;

  const attrIds = await loadMemberAttrIds(memberId);
  const { data: memos } = await supabaseAdmin
    .from("member_memos")
    .select("title, body")
    .eq("member_id", memberId)
    .order("sort_order")
    .limit(5);

  // 流入経路は sources マスタから表示名を解決する（Phase 3）
  const label = await sourceLabeler();

  return {
    id: m.id,
    name: m.name ?? "",
    role: m.role ?? "",
    company: m.company ?? "",
    source: label(m.source_id),
    prefecture: m.prefecture ?? "",
    createdAt: (m.created_at ?? "").slice(0, 10),
    attrIds,
    attrLabels: attrNames(tree, attrIds),
    memos: (memos ?? [])
      .map((x) => [x.title, x.body].filter(Boolean).join(": ").trim())
      .filter(Boolean),
  };
}

/** プロンプトに入れる顧客ブロック */
export function profileBlock(p: MemberProfile): string {
  const lines = [
    `氏名: ${p.name}`,
    p.company ? `所属: ${p.company}` : "",
    p.attrLabels.length ? `属性: ${p.attrLabels.join(", ")}` : "",
    p.source ? `流入経路: ${p.source}` : "",
    p.prefecture ? `都道府県: ${p.prefecture}` : "",
    p.createdAt ? `登録日: ${p.createdAt}` : "",
    p.memos.length ? `メモ:\n${p.memos.map((x) => `  - ${maskText(x)}`).join("\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

// ── 参照資料（そのメンバーに公開中のものだけ）──────────────
export interface RefDoc {
  citation: AiCitation;
  text: string;
}

/** 本文を素のテキストに寄せる（HTMLタグを落とす） */
const plain = (s: string): string =>
  (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const MAX_DOC_CHARS = 1200;

/**
 * メンバーが閲覧できる公開中のコンテンツ本文・お知らせを集める。
 * ★ 情報漏えい防止の要。ここで公開判定を通したものだけをAIに渡す。
 */
export async function loadVisibleDocs(memberId: number, tree: AttrTree): Promise<RefDoc[]> {
  const myAttrs = await loadMemberAttrIds(memberId);

  const [{ data: contents }, { data: cAttrs }, { data: news }, { data: nAttrs }] = await Promise.all([
    supabaseAdmin.from("contents").select("id, name, body_text, body_html, none_mode, attr_mode, url, kind")
      .eq("is_deleted", false).eq("published", true),
    supabaseAdmin.from("content_attributes").select("content_id, attribute_id"),
    supabaseAdmin.from("news").select("id, title, body_text, body_html, body_mode, attr_mode")
      .eq("is_deleted", false).eq("published", true),
    supabaseAdmin.from("news_attributes").select("news_id, attribute_id"),
  ]);

  const cAttrMap = new Map<number, number[]>();
  for (const r of cAttrs ?? []) {
    const a = cAttrMap.get(r.content_id) ?? [];
    a.push(r.attribute_id);
    cAttrMap.set(r.content_id, a);
  }
  const nAttrMap = new Map<number, number[]>();
  for (const r of nAttrs ?? []) {
    const a = nAttrMap.get(r.news_id) ?? [];
    a.push(r.attribute_id);
    nAttrMap.set(r.news_id, a);
  }

  const docs: RefDoc[] = [];

  for (const c of contents ?? []) {
    const ids = cAttrMap.get(c.id) ?? [];
    if (!canView(ids, asMode(c.attr_mode), myAttrs, tree)) continue;
    const body = plain(c.none_mode === "html" ? c.body_html : c.body_text);
    const extra = c.url ? `（URL: ${c.url}）` : "";
    if (!body && !extra) continue;
    docs.push({
      citation: { kind: "content", id: c.id, title: c.name ?? "" },
      text: `[content:${c.id}] ${c.name}${extra} — ${body.slice(0, MAX_DOC_CHARS)}`,
    });
  }

  for (const n of news ?? []) {
    const ids = nAttrMap.get(n.id) ?? [];
    if (!canView(ids, asMode(n.attr_mode), myAttrs, tree)) continue;
    const body = plain(n.body_mode === "html" ? n.body_html : n.body_text);
    if (!body) continue;
    docs.push({
      citation: { kind: "news", id: n.id, title: n.title ?? "" },
      text: `[news:${n.id}] ${n.title} — ${body.slice(0, MAX_DOC_CHARS)}`,
    });
  }

  return docs;
}

// ── チャット履歴 ──────────────────────────────────────────────
const MAX_CONTEXT_MESSAGES = Number(process.env.AI_MAX_CONTEXT_MESSAGES ?? 40);

/** 会話を時系列のテキストに（既存 /api/chat/summarize と同じ形式）*/
export async function buildTranscript(
  conversationId: number,
  limit = MAX_CONTEXT_MESSAGES,
): Promise<{ text: string; count: number }> {
  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("sender_side, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const msgs = (data ?? []).slice().reverse();
  const text = msgs
    .map((m) => {
      const who = m.sender_side === "staff" ? "事務局" : "顧客";
      const ts = (m.created_at ?? "").replace("T", " ").slice(0, 16);
      const body = maskText((m.body ?? "").trim()) || "（添付ファイル）";
      return `[${ts}] ${who}: ${body}`;
    })
    .join("\n");
  return { text, count: msgs.length };
}

/** 直近の未返信（顧客発）メッセージ */
export async function lastMemberMessage(conversationId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("sender_side", "member")
    .order("created_at", { ascending: false })
    .limit(1);
  return maskText((data?.[0]?.body ?? "").trim());
}

/** 会話 → 顧客の member_id */
export async function memberIdOfConversation(conversationId: number): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("member_id")
    .eq("id", conversationId)
    .maybeSingle();
  return data?.member_id ?? null;
}

// ── LINEトーク版（Phase 3）：line_messages から文脈を組む ─────────
/** LINE友だち → 連携会員の member_id（未連携は null） */
export async function memberIdOfFriend(friendId: number): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("member_id")
    .eq("id", friendId)
    .maybeSingle();
  return data?.member_id ?? null;
}

/** LINEトークの会話履歴（時系列） */
export async function buildLineTranscript(
  friendId: number,
  limit = MAX_CONTEXT_MESSAGES,
): Promise<{ text: string; count: number }> {
  const { data } = await supabaseAdmin
    .from("line_messages")
    .select("direction, body, msg_type, created_at")
    .eq("friend_id", friendId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const msgs = (data ?? []).slice().reverse();
  const text = msgs
    .map((m) => {
      const who = m.direction === "out" ? "事務局" : "顧客";
      const ts = (m.created_at ?? "").replace("T", " ").slice(0, 16);
      const body = maskText((m.body ?? "").trim()) || (m.msg_type === "text" ? "" : "（メディア）");
      return `[${ts}] ${who}: ${body}`;
    })
    .join("\n");
  return { text, count: msgs.length };
}

/** 直近の未返信（顧客発＝direction='in'）メッセージ */
export async function lastLineInbound(friendId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from("line_messages")
    .select("body")
    .eq("friend_id", friendId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1);
  return maskText((data?.[0]?.body ?? "").trim());
}

// ── ナレッジ・文体ガイド ─────────────────────────────────────
export async function loadKnowledge(): Promise<{ text: string; count: number }> {
  const { data } = await supabaseAdmin
    .from("ai_knowledge")
    .select("id, title, body")
    .eq("published", true)
    .order("sort_order")
    .limit(30);
  const rows = data ?? [];
  return {
    text: rows.map((k) => `[kb:${k.id}] ${k.title} — ${(k.body ?? "").slice(0, 800)}`).join("\n"),
    count: rows.length,
  };
}

// ── トークのブックマーク（最優先ナレッジ）──────────────────────
//   運営が「良い案内」と判断したトークをジャンル付きで蓄積したもの。
//   AI返信提案はこれを社内ナレッジより優先して参照する。
export async function loadBookmarkKnowledge(): Promise<{ text: string; count: number }> {
  const sb = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await sb
    .from("chat_bookmarks")
    .select("id, genre, expected_question, keywords, formatted_reply")
    .eq("ai_enabled", true)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as {
    id: number; genre: string; expected_question: string | null;
    keywords: string[] | null; formatted_reply: string | null;
  }[];
  return {
    text: rows.map((k) => {
      const kw = (k.keywords ?? []).join("・");
      return `[bm:${k.id}][${k.genre}] 想定質問: ${k.expected_question ?? ""} / キーワード: ${kw}\n→ ${(k.formatted_reply ?? "").slice(0, 600)}`;
    }).join("\n\n"),
    count: rows.length,
  };
}

export async function loadStyleGuide(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("ai_style_guide")
    .eq("id", 1)
    .maybeSingle();
  return (data?.ai_style_guide ?? "").trim();
}

// ── ブックマークの関連検索（RAG）──────────────────────────────
//   返信提案の精度向上：「質問（顧客の直前メッセージ）」に関連する上位K件だけを渡す。
//
//   ⚠️ 2026-08-23（R4・フェーズB一本化）
//     ・知識源を knowledge_chunks（フェーズB）へ一本化した。
//       取り込み元 chat_bookmark に絞って検索するので、参照する中身は従来と同じ
//       chat_bookmarks(ai_enabled=true) のまま。
//     ・旧経路（bot_bm_index / bot_hybrid_search）と「全件ダンプ」は
//       AI_PHASE_A_FALLBACK=true のときだけ使う切り戻し用に降格した。
//     ・環境変数 AI_REPLY_BM_RETRIEVAL / AI_REPLY_BM_TOPK は廃止。
const PHASE_A_FALLBACK = process.env.AI_PHASE_A_FALLBACK === "true";
const REPLY_TOPK = Number(process.env.AI_REPLY_TOPK ?? 8);

interface HybridRow { bookmark_id: number; genre: string; answer_text: string; score: number }

/**
 * 【切り戻し用】旧フェーズA索引での検索。
 * ⚠️ AI_PHASE_A_FALLBACK=true のときだけ呼ばれる。通常運転では使わない。
 */
async function retrieveFromPhaseA(
  query: string, k: number,
): Promise<{ text: string; count: number } | null> {
  try {
    const emb = await embedText(query);
    const vec = toVectorLiteral(emb);
    if (!vec) return null;
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const { data, error } = await sb.rpc("bot_hybrid_search", {
      q: query.slice(0, 500), q_emb: vec, cats: null, k,
    });
    if (error) return null;
    const rows = ((data as HybridRow[] | null) ?? []).filter((r) => (r.score ?? 0) > 0);
    if (rows.length === 0) return null;
    return {
      text: rows
        .map((r) => `[bm:${r.bookmark_id}][${r.genre}] → ${(r.answer_text ?? "").slice(0, 600)}`)
        .join("\n\n"),
      count: rows.length,
    };
  } catch {
    return null;   // 埋め込み未設定・接続障害など（develop.md §9：本処理は止めない）
  }
}

/**
 * 質問文に関連するブックマークを上位k件検索して整形テキストにする。
 * 検索できない／0件のときは null を返す（呼び出し側でフォールバック）。
 */
export async function retrieveBookmarkKnowledge(
  query: string, k = REPLY_TOPK,
): Promise<{ text: string; count: number } | null> {
  const q = (query ?? "").trim();
  if (!q) return null;

  if (PHASE_A_FALLBACK) return retrieveFromPhaseA(q, k);

  try {
    // 取り込み元を chat_bookmark に絞る。
    //   ・検索v2 では RPC 引数で絞る。
    //   ・旧 knowledge_public_search は絞り込み引数を持たないため、多めに取って手元で絞る。
    //     どちらの経路でも最終的に返るのはブックマーク由来の断片だけになる。
    const rows = await retrieveKnowledge(q, k * 3, { sourceTypes: ["chat_bookmark"] });
    const hits = rows.filter((r) => r.sourceType === "chat_bookmark").slice(0, k);
    if (hits.length === 0) return null;
    return {
      text: hits
        .map((r) => `[${r.title ?? "ブックマーク"}] → ${(r.text ?? "").slice(0, 600)}`)
        .join("\n\n"),
      count: hits.length,
    };
  } catch {
    return null;   // 検索できないときは黙って諦める（本処理は止めない）
  }
}

/**
 * 返信提案用のブックマーク取得。
 *   通常：フェーズBのナレッジ検索で上位K件。
 *   切り戻し時（AI_PHASE_A_FALLBACK=true）：旧索引 →（0件なら）全件ダンプ。
 *   ⚠️ 通常運転では全件ダンプへ落ちない。検索が0件なら「関連なし」として空を返す。
 *      全件ダンプはトークンを大量に使ううえ、関係ない案内例が混ざって精度を下げるため。
 */
export async function loadBookmarkKnowledgeFor(
  query: string,
): Promise<{ text: string; count: number }> {
  const hit = await retrieveBookmarkKnowledge(query);
  if (hit) return hit;
  if (PHASE_A_FALLBACK) return loadBookmarkKnowledge();
  return { text: "", count: 0 };
}

// ── ⑤ 配信対象の集計（個人情報は渡さず、内訳だけ渡す）────────
export interface Audience {
  total: number;
  breakdown: Record<string, number>;
  sourceBreakdown: Record<string, number>;
}

export async function computeAudience(target: BcTarget, tree: AttrTree): Promise<Audience> {
  const { data: members } = await supabaseAdmin
    .from("members")
    .select("id, role, source_id")
    .eq("is_deleted", false);

  const { data: links } = await supabaseAdmin
    .from("member_attributes")
    .select("member_id, attribute_id")
    .not("member_id", "is", null);

  const attrsOf = new Map<number, number[]>();
  for (const r of links ?? []) {
    if (r.member_id == null) continue;
    const a = attrsOf.get(r.member_id) ?? [];
    a.push(r.attribute_id);
    attrsOf.set(r.member_id, a);
  }

  // 流入経路マスタ（Phase 3：カテゴリ判定・表示名の解決に使う）
  const sourceIndex = await loadSourceIndex();

  // 運営ロール（オペレーターの派生ロール含む）。サーバー側なので明示的に解決する。
  const staffKeys = await loadStaffRoleKeys();

  // lib/broadcast.ts の matchRecipient と同じ判定（運営スタッフは対象外）
  const hit = (members ?? []).filter((m) => {
    if (staffKeys.has(m.role ?? "")) return false;
    if (target.targetMode === "all") return true;
    if (!matchSource(m.source_id, {
      targetSourceIds:  target.targetSourceIds,
      targetSourceCats: target.targetSourceCats as SourceCategory[],
    }, sourceIndex)) return false;
    if (target.targetAttrIds.length > 0) {
      const ids = attrsOf.get(m.id) ?? [];
      if (!target.targetAttrIds.some((id) => ids.includes(id))) return false;
    }
    return true;
  });

  const breakdown: Record<string, number> = {};
  const sourceBreakdown: Record<string, number> = {};
  for (const m of hit) {
    for (const aid of attrsOf.get(m.id) ?? []) {
      const label = tree.name.get(aid);
      if (!label) continue;
      breakdown[label] = (breakdown[label] ?? 0) + 1;
    }
    const s = m.source_id != null ? (sourceIndex.get(m.source_id)?.label ?? "（不明な経路）") : "（経路なし）";
    sourceBreakdown[s] = (sourceBreakdown[s] ?? 0) + 1;
  }

  return { total: hit.length, breakdown, sourceBreakdown };
}

/** 集計をプロンプト用テキストに */
export function audienceBlock(a: Audience): string {
  const attrs = Object.entries(a.breakdown)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${v}名`)
    .join(" / ") || "（属性なし）";
  const src = Object.entries(a.sourceBreakdown)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${v}名`)
    .join(" / ") || "（不明）";
  return `対象: ${a.total}名\n属性内訳: ${attrs}\n流入経路: ${src}`;
}

// ── ⑥ データ検索：scope 別の「許可済み」データ収集 ──────────────
//   AIにSQL権限を渡さない。scope に対応する固定の集計/抽出だけを実行し、
//   その結果テキストをAIに渡す。AIは絞り込み・要約・表整形のみを担う。
//   呼び出し元（route）が requireOps で認可済みであることが前提。

const SEARCH_ROW_LIMIT = 300;

/** members：会員一覧（属性ラベル・流入経路つき）。個人情報を含む。 */
async function searchMembers(tree: AttrTree): Promise<string> {
  const [{ data: members }, { data: links }] = await Promise.all([
    supabaseAdmin
      .from("members")
      .select("id, name, kana, company, prefecture, role, source_id, created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(SEARCH_ROW_LIMIT),
    supabaseAdmin.from("member_attributes").select("member_id, attribute_id").not("member_id", "is", null),
  ]);

  const attrsOf = new Map<number, number[]>();
  for (const r of links ?? []) {
    if (r.member_id == null) continue;
    const a = attrsOf.get(r.member_id) ?? [];
    a.push(r.attribute_id);
    attrsOf.set(r.member_id, a);
  }
  const label = await sourceLabeler();

  const rows = (members ?? []).map((m) => {
    const attrs = attrNames(tree, attrsOf.get(m.id) ?? []).join("・") || "-";
    // 氏名・属性は渡す。メール・電話は列に含めない（含める場合は maskValue を通すこと）。
    return [
      `氏名: ${m.name ?? ""}`,
      m.company ? `所属: ${m.company}` : "",
      m.prefecture ? `都道府県: ${m.prefecture}` : "",
      `ロール: ${m.role ?? ""}`,
      `流入経路: ${label(m.source_id)}`,
      `登録日: ${(m.created_at ?? "").slice(0, 10)}`,
      `属性: ${attrs}`,
    ].filter(Boolean).join(" / ");
  });
  return `対象テーブル: members（会員） 全 ${rows.length} 行（最新 ${SEARCH_ROW_LIMIT} 件まで）\n` + rows.join("\n");
}

/** chat_stats：事務局チャットの集計値（個人情報は渡さない）。 */
async function searchChatStats(): Promise<string> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5).toISOString();
  const d30 = new Date(now - 30 * 864e5).toISOString();

  const [conv, msgTotal, msgStaff, msgMember, msg7, msg30] = await Promise.all([
    supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).eq("sender_side", "staff"),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).eq("sender_side", "member"),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", d7),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", d30),
  ]);

  return [
    "対象: chat_stats（事務局チャットの集計。個人情報・本文は含まない）",
    `会話スレッド数: ${conv.count ?? 0}`,
    `総メッセージ数: ${msgTotal.count ?? 0}（事務局 ${msgStaff.count ?? 0} / 顧客 ${msgMember.count ?? 0}）`,
    `直近7日のメッセージ数: ${msg7.count ?? 0}`,
    `直近30日のメッセージ数: ${msg30.count ?? 0}`,
  ].join("\n");
}

/** contents：掲載コンテンツ・お知らせの一覧（本文は含めない）。 */
async function searchContents(): Promise<string> {
  const [{ data: contents }, { data: news }] = await Promise.all([
    supabaseAdmin.from("contents")
      .select("id, name, kind, published, created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(SEARCH_ROW_LIMIT),
    supabaseAdmin.from("news")
      .select("id, title, published, created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(SEARCH_ROW_LIMIT),
  ]);

  const cRows = (contents ?? []).map((c) =>
    `[contents] ${c.name ?? ""} / 種別: ${c.kind ?? ""} / 公開: ${c.published ? "公開中" : "非公開"} / 作成: ${(c.created_at ?? "").slice(0, 10)}`);
  const nRows = (news ?? []).map((n) =>
    `[news] ${n.title ?? ""} / 公開: ${n.published ? "公開中" : "非公開"} / 作成: ${(n.created_at ?? "").slice(0, 10)}`);
  return `対象: contents / news（掲載物の一覧。本文は含まない）\n` + [...cRows, ...nRows].join("\n");
}

/** payments：決済データ（一覧＋集計）。個人情報を含む。 */
async function searchPayments(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("payments")
    .select("customer_name, amount, recognized_amount, status, site, method, paid_at, created_at")
    .eq("is_deleted", false)
    .order("paid_at", { ascending: false })
    .limit(SEARCH_ROW_LIMIT);

  const rows = (data ?? []).map((p) =>
    // 決済データは自由記述を含みうるため、行を組んでから maskText に通す（下部）
    [
      `顧客: ${p.customer_name ?? ""}`,
      `金額: ${p.amount ?? 0}`,
      `認識額: ${p.recognized_amount ?? 0}`,
      `状態: ${p.status ?? ""}`,
      `サイト: ${p.site ?? ""}`,
      `方法: ${p.method ?? ""}`,
      `入金日: ${(p.paid_at ?? "").slice(0, 10) || "-"}`,
    ].join(" / "));
  const total = (data ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
  return `対象: payments（決済） 全 ${rows.length} 行（最新 ${SEARCH_ROW_LIMIT} 件まで） / 合計金額: ${total}\n` + rows.join("\n");
}

const SEARCH_MAX_CHARS = 12000;

/**
 * scope に応じた参照データを収集して1つのテキストにする。
 * 返り値はそのまま callClaude の user メッセージに載せる。
 */
export async function collectSearchData(scope: SearchScope, query: string): Promise<string> {
  let block: string;
  switch (scope) {
    case "members":    block = await searchMembers(await loadAttrTree()); break;
    case "chat_stats": block = await searchChatStats(); break;
    case "contents":   block = await searchContents(); break;
    case "payments":   block = await searchPayments(); break;
    default:           block = "（対応していない検索範囲です）";
  }
  // ★ 個人情報のマスキングはここで一括して行う（プロンプト組み立ての最後）
  const masked = maskText(block);
  const clamped = masked.length > SEARCH_MAX_CHARS
    ? masked.slice(0, SEARCH_MAX_CHARS) + "\n…（以下省略）"
    : masked;
  // ★ 参照データはタグで囲む（自由記述に指示が混ざっていても資料として扱わせる）
  return `検索条件（scope=${scope}）:\n${(query ?? "").slice(0, 1000)}\n\n参照データ:\n${wrap("knowledge", clamped)}`;
}
