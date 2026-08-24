// ============================================================
// 会員ポータルの資料・お知らせ → ナレッジ中間表現（R3 / Ph2・service_role 専用）
//
//   ★ 情報漏えい防止の要。ここで文書に写した「公開対象の属性」が、
//      検索時に doc_visible_to() で効く唯一の根拠になる。
//      lib/ai/context.ts の loadVisibleDocs() と同じ条件を写すこと。
//
//   現行 loadVisibleDocs() との対応
//     ・contents … is_deleted=false かつ published=true のみ  → 同じ
//     ・news     … is_deleted=false かつ published=true のみ  → 同じ
//     ・属性判定 … canView(attrIds, attr_mode, ...)           → target_attr_ids / attr_mode に写す
//
//   現行と意図的に変えた点（いずれも「見せる範囲を狭める」方向のみ）
//     ①news の published_at が未来のものは取り込まない
//       （予約投稿がAIから先に読めてしまうのを防ぐ。会員ポータルの visibleNews() は元から除外している）
//       ★ そのため未来日のお知らせは公開時刻を過ぎてから索引に入る（cron 1回分の遅れが出る）
//     ②news に既定90日の expires_at を入れる（古い連絡が回答に混ざるのを防ぐ）
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../supabaseAdmin";
import { chunkMarkdown, estimateTokens } from "./chunk";
import type { AttrMode, ParsedChunk, ParsedDoc, ParsedUnit } from "./types";

const sb = supabaseAdmin as unknown as SupabaseClient;

/** お知らせの既定の有効期間（日）。0 以下なら無期限。 */
const NEWS_TTL_DAYS = Number(process.env.AI_NEWS_TTL_DAYS ?? 90);

const asMode = (s: string | null | undefined): AttrMode =>
  s === "all" || s === "exany" || s === "exall" ? s : "any";

// ── HTML → Markdown 寄せ ─────────────────────────────────────
//   見出しを残すのは、chunkMarkdown が見出しで切れ目を作るため。
//   （見出しを落とすと長文が1chunkになり、検索の粒度が粗くなる）
const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, " "], [/&amp;/gi, "&"], [/&lt;/gi, "<"],
  [/&gt;/gi, ">"], [/&quot;/gi, '"'], [/&#0?39;|&apos;/gi, "'"],
];

export function htmlToMarkdown(html: string): string {
  let s = html ?? "";
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<h1[^>]*>/gi, "\n\n# ").replace(/<h2[^>]*>/gi, "\n\n## ");
  s = s.replace(/<h[3-6][^>]*>/gi, "\n\n### ");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|ul|ol|table|section|article)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 本文が短いときは chunkMarkdown が空を返すことがあるため、必ず1件は作る。 */
function toChunks(body: string): ParsedChunk[] {
  const chunks = chunkMarkdown(body);
  if (chunks.length) return chunks;
  const t = body.trim();
  if (!t) return [];
  return [{
    ordinal: 0, headingPath: [], chunkKind: "prose", text: t,
    startChar: 0, endChar: t.length, tokenCount: estimateTokens(t),
  }];
}

function buildUnit(title: string | null, body: string): ParsedUnit {
  return {
    unitKind: "article", ordinal: 0, title, body,
    speaker: "system", isAuthorVoice: false, retrievalMode: "answer_only",
    freshnessClass: null, chunks: toChunks(body),
  };
}

async function loadAttrMap(
  table: string, fkColumn: string,
): Promise<Map<number, number[]>> {
  const { data } = await sb.from(table).select(`${fkColumn}, attribute_id`);
  const rows = (data as Record<string, number>[] | null) ?? [];
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const key = r[fkColumn];
    const a = map.get(key) ?? [];
    a.push(r.attribute_id);
    map.set(key, a);
  }
  return map;
}

// ── contents ─────────────────────────────────────────────────
interface ContentRow {
  id: number; name: string | null; body_text: string | null; body_html: string | null;
  none_mode: string | null; attr_mode: string | null; url: string | null; kind: string | null;
  is_external: boolean | null; public_token: string | null; created_at: string | null;
}

export async function loadContentDocs(): Promise<ParsedDoc[]> {
  const [{ data }, attrMap] = await Promise.all([
    sb.from("contents")
      .select("id, name, body_text, body_html, none_mode, attr_mode, url, kind, is_external, public_token, created_at")
      .eq("is_deleted", false).eq("published", true),
    loadAttrMap("content_attributes", "content_id"),
  ]);
  const rows = (data as ContentRow[] | null) ?? [];

  const docs: ParsedDoc[] = [];
  for (const c of rows) {
    const raw = c.none_mode === "html" ? (c.body_html ?? "") : (c.body_text ?? "");
    const body = c.none_mode === "html" ? htmlToMarkdown(raw) : (raw ?? "").trim();
    const urlLine = c.url ? `参照URL: ${c.url}` : "";
    const text = [body, urlLine].filter(Boolean).join("\n\n");
    if (!text) continue;   // 本文もURLも無い資料は索引しても引けない

    const title = (c.name ?? "").trim() || null;
    // 見出しとして名前を先頭に置く。検索語が本文に出なくても資料名で拾えるようにする。
    const normalized = title ? `# ${title}\n\n${text}` : text;

    // 外部公開ONは属性条件を無視して誰でも見られる（lib/contentsServer.ts の判定順に合わせる）
    const external = c.is_external === true;
    docs.push({
      sourceType: "content",
      relativePath: `contents/${c.id}`,
      externalId: `content:${c.id}`,
      canonicalUrl: external && c.public_token ? `/c/${c.public_token}` : null,
      title,
      rawText: raw,
      normalizedText: normalized,
      publicationStatus: "published",
      visibility: external ? "public" : "member",
      documentKind: "article",
      isAuthorVoice: false,
      retrievalMode: "answer_only",
      units: [buildUnit(title, normalized)],
      targetAttrIds: external ? [] : (attrMap.get(c.id) ?? []),
      attrMode: asMode(c.attr_mode),
      tags: c.kind ? [`kind:${c.kind}`] : [],
      expiresAt: null,
      publishedAt: c.created_at ?? null,
    });
  }
  return docs;
}

// ── news ─────────────────────────────────────────────────────
interface NewsRow {
  id: number; title: string | null; body_text: string | null; body_html: string | null;
  body_mode: string | null; attr_mode: string | null; category: string | null;
  important: boolean | null; published_at: string | null; created_at: string | null;
}

export async function loadNewsDocs(): Promise<ParsedDoc[]> {
  const [{ data }, attrMap] = await Promise.all([
    sb.from("news")
      .select("id, title, body_text, body_html, body_mode, attr_mode, category, important, published_at, created_at")
      .eq("is_deleted", false).eq("published", true),
    loadAttrMap("news_attributes", "news_id"),
  ]);
  const rows = (data as NewsRow[] | null) ?? [];
  const now = Date.now();

  const docs: ParsedDoc[] = [];
  for (const n of rows) {
    const at = n.published_at ? new Date(n.published_at).getTime() : NaN;
    // 予約投稿（未来日）は取り込まない ＝ 公開時刻前にAIから読めないようにする
    if (!isNaN(at) && at > now) continue;

    const raw = n.body_mode === "html" ? (n.body_html ?? "") : (n.body_text ?? "");
    const body = n.body_mode === "html" ? htmlToMarkdown(raw) : (raw ?? "").trim();
    if (!body) continue;

    const title = (n.title ?? "").trim() || null;
    const normalized = title ? `# ${title}\n\n${body}` : body;

    const base = !isNaN(at) ? at : (n.created_at ? new Date(n.created_at).getTime() : NaN);
    const expiresAt = NEWS_TTL_DAYS > 0 && !isNaN(base)
      ? new Date(base + NEWS_TTL_DAYS * 86_400_000).toISOString()
      : null;

    const tags = [n.category ? `category:${n.category}` : "", n.important ? "important" : ""].filter(Boolean);

    docs.push({
      sourceType: "news",
      relativePath: `news/${n.id}`,
      externalId: `news:${n.id}`,
      canonicalUrl: null,
      title,
      rawText: raw,
      normalizedText: normalized,
      publicationStatus: "published",
      visibility: "member",       // お知らせは会員限定。公開ボットからは引かない。
      documentKind: "article",
      isAuthorVoice: false,
      retrievalMode: "answer_only",
      units: [buildUnit(title, normalized)],
      targetAttrIds: attrMap.get(n.id) ?? [],
      attrMode: asMode(n.attr_mode),
      tags,
      expiresAt,
      publishedAt: n.published_at ?? n.created_at ?? null,
    });
  }
  return docs;
}
