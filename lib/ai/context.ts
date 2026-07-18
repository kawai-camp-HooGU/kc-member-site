// ============================================================
// AIへ渡すコンテキストの収集（サーバー専用）
//
//   重要: コンテキストは必ずサーバー側で組み立てる。
//   クライアントから受け取った本文をそのままプロンプトに入れない
//   （改ざん・越権参照を防ぐ）。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { loadSourceIndex, sourceLabeler } from "../sourcesServer";
import { matchSource } from "../sources";
import type { PublishMode, SourceCategory } from "../models";
import type { AiCitation, BcTarget } from "./types";

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
    p.memos.length ? `メモ:\n${p.memos.map((x) => `  - ${x}`).join("\n")}` : "",
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
      const body = (m.body ?? "").trim() || "（添付ファイル）";
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
  return (data?.[0]?.body ?? "").trim();
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
    .select("member_id, attribute_id");

  const attrsOf = new Map<number, number[]>();
  for (const r of links ?? []) {
    const a = attrsOf.get(r.member_id) ?? [];
    a.push(r.attribute_id);
    attrsOf.set(r.member_id, a);
  }

  // 流入経路マスタ（Phase 3：カテゴリ判定・表示名の解決に使う）
  const sourceIndex = await loadSourceIndex();

  // lib/broadcast.ts の matchRecipient と同じ判定（運営スタッフは対象外）
  const hit = (members ?? []).filter((m) => {
    if (m.role === "管理者" || m.role === "オペレーター") return false;
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
