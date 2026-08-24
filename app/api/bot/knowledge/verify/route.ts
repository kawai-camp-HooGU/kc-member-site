// ============================================================
// GET /api/bot/knowledge/verify — 公開判定の同値性チェック（★H2 のゲート）
//
//   目的
//     ナレッジ検索 v2 は「誰がどの資料を読めるか」を SQL（doc_visible_to）で判定する。
//     現行の判定はアプリ側の canView()。この2つがズレると、
//     会員が本来見えない資料をAI経由で読めてしまう。
//     ①メンバーAI相談を v2 へ切り替える前に、このチェックが 0 件差分になることを必ず確認する。
//
//   何を比べるか
//     A. 取り込みの写し間違い … contents / news の属性設定 と knowledge_documents の
//        target_attr_ids / attr_mode が一致するか
//     B. 判定のズレ           … 全会員 × 全文書で canView()（アプリ）と
//        doc_visible_to()（SQL）の結果が一致するか
//
//   使い方
//     GET /api/bot/knowledge/verify            … 判定（A・B）だけ行う
//     GET /api/bot/knowledge/verify?limit=200  … 会員数を絞って試す（既定は全員）
//   ⚠️ 運営のみ。件数が多いと時間がかかるため maxDuration を長めに取る。
//   ⚠️ 差分が1件でもあれば ok:false。中身を直すまで v2 を会員向けに有効化しないこと。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { requireOps, errorResponse } from "../../../../../lib/authz";
import { loadAttrTree, canView, type AttrTree } from "../../../../../lib/ai/context";
import type { PublishMode } from "../../../../../lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sb = supabaseAdmin as unknown as SupabaseClient;

/** 1回の RPC に載せる会員数。大きすぎるとタイムアウトする。 */
const MEMBER_BATCH = 200;
/** 報告する差分の上限（全部返すとレスポンスが巨大になる） */
const MAX_REPORT = 50;

const asMode = (s: string | null | undefined): PublishMode =>
  s === "all" || s === "exany" || s === "exall" ? s : "any";

interface DocRow {
  id: number;
  external_id: string | null;
  visibility: string;
  attr_mode: string | null;
  target_attr_ids: number[] | null;
}

/** メンバーの属性IDを祖先方向へ展開する（SQL 側は展開済み前提） */
function expand(own: number[], tree: AttrTree): number[] {
  const out = new Set<number>();
  for (const id of own) for (const a of tree.ancestors.get(id) ?? []) out.add(a);
  return [...out];
}

export async function GET(request: Request) {
  try {
    await requireOps(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 0);

    const tree = await loadAttrTree();

    // ── 対象文書（contents / news 由来で会員限定のもの）──
    const { data: srcData } = await sb.from("knowledge_sources")
      .select("id, source_type").in("source_type", ["content", "news"]);
    const sourceIds = ((srcData as { id: number; source_type: string }[] | null) ?? []).map((r) => r.id);
    if (!sourceIds.length) {
      return NextResponse.json({
        ok: false,
        reason: "knowledge_sources に content / news がありません。migration_ai_search_v2.sql を適用してください。",
      });
    }

    const { data: docData } = await sb.from("knowledge_documents")
      .select("id, external_id, visibility, attr_mode, target_attr_ids")
      .in("source_id", sourceIds).eq("is_active", true).eq("publication_status", "published");
    const docs = (docData as DocRow[] | null) ?? [];
    const memberDocs = docs.filter((d) => d.visibility === "member");

    // ── A. 取り込みの写し間違い ──
    const [{ data: cRows }, { data: cAttrs }, { data: nRows }, { data: nAttrs }] = await Promise.all([
      sb.from("contents").select("id, attr_mode, is_external").eq("is_deleted", false).eq("published", true),
      sb.from("content_attributes").select("content_id, attribute_id"),
      sb.from("news").select("id, attr_mode").eq("is_deleted", false).eq("published", true),
      sb.from("news_attributes").select("news_id, attribute_id"),
    ]);

    const attrsOf = (rows: Record<string, number>[] | null, fk: string): Map<number, number[]> => {
      const m = new Map<number, number[]>();
      for (const r of rows ?? []) {
        const a = m.get(r[fk]) ?? [];
        a.push(r.attribute_id);
        m.set(r[fk], a);
      }
      return m;
    };
    const cAttrMap = attrsOf(cAttrs as Record<string, number>[] | null, "content_id");
    const nAttrMap = attrsOf(nAttrs as Record<string, number>[] | null, "news_id");
    const cMeta = new Map(((cRows as { id: number; attr_mode: string | null; is_external: boolean | null }[] | null) ?? [])
      .map((r) => [r.id, r]));
    const nMeta = new Map(((nRows as { id: number; attr_mode: string | null }[] | null) ?? [])
      .map((r) => [r.id, r]));

    const copyDiffs: { doc: number; externalId: string; detail: string }[] = [];
    const same = (a: number[], b: number[]): boolean =>
      a.length === b.length && [...a].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");

    for (const d of docs) {
      const ext = d.external_id ?? "";
      const m = ext.match(/^(content|news):(\d+)$/);
      if (!m) { copyDiffs.push({ doc: d.id, externalId: ext, detail: "external_id の形式が想定外" }); continue; }
      const id = Number(m[2]);
      const isContent = m[1] === "content";
      const meta = isContent ? cMeta.get(id) : nMeta.get(id);
      if (!meta) { copyDiffs.push({ doc: d.id, externalId: ext, detail: "元が非公開／削除済みなのに is_active のまま" }); continue; }

      const external = isContent && (meta as { is_external?: boolean | null }).is_external === true;
      const expectAttrs = external ? [] : ((isContent ? cAttrMap.get(id) : nAttrMap.get(id)) ?? []);
      const expectMode = asMode(meta.attr_mode);
      const expectVis = external ? "public" : "member";

      if (d.visibility !== expectVis) {
        copyDiffs.push({ doc: d.id, externalId: ext, detail: `visibility ${d.visibility} ≠ ${expectVis}` });
      }
      if (!same(d.target_attr_ids ?? [], expectAttrs)) {
        copyDiffs.push({ doc: d.id, externalId: ext, detail: `属性 [${(d.target_attr_ids ?? []).join(",")}] ≠ [${expectAttrs.join(",")}]` });
      }
      if (asMode(d.attr_mode) !== expectMode) {
        copyDiffs.push({ doc: d.id, externalId: ext, detail: `attr_mode ${d.attr_mode} ≠ ${expectMode}` });
      }
    }

    // ── B. 判定のズレ（全会員 × 会員限定文書）──
    let q = sb.from("members").select("id").eq("is_deleted", false).order("id");
    if (limit > 0) q = q.limit(limit);
    const { data: memberData } = await q;
    const memberIds = ((memberData as { id: number }[] | null) ?? []).map((r) => r.id);

    const { data: maData } = await sb.from("member_attributes").select("member_id, attribute_id");
    const myAttrs = new Map<number, number[]>();
    for (const r of (maData as { member_id: number; attribute_id: number }[] | null) ?? []) {
      const a = myAttrs.get(r.member_id) ?? [];
      a.push(r.attribute_id);
      myAttrs.set(r.member_id, a);
    }

    const judgeDiffs: { memberId: number; doc: number; app: boolean; sql: boolean }[] = [];
    let pairs = 0;

    for (let i = 0; i < memberIds.length; i += MEMBER_BATCH) {
      const batch = memberIds.slice(i, i + MEMBER_BATCH);
      const payload = batch.map((id) => ({ member_id: id, attrs: expand(myAttrs.get(id) ?? [], tree) }));

      const { data: matrix, error } = await sb.rpc("knowledge_visibility_matrix", { p_members: payload });
      if (error) {
        return NextResponse.json({
          ok: false,
          reason: "knowledge_visibility_matrix の呼び出しに失敗しました。migration_ai_search_v2.sql を適用してください。",
          error: error.message,
        });
      }
      const visible = new Set<string>();
      for (const r of (matrix as { member_id: number; document_id: number }[] | null) ?? []) {
        visible.add(`${r.member_id}:${r.document_id}`);
      }

      for (const memberId of batch) {
        const own = myAttrs.get(memberId) ?? [];
        for (const d of memberDocs) {
          pairs++;
          const app = canView(d.target_attr_ids ?? [], asMode(d.attr_mode), own, tree);
          const sql = visible.has(`${memberId}:${d.id}`);
          if (app !== sql && judgeDiffs.length < MAX_REPORT) {
            judgeDiffs.push({ memberId, doc: d.id, app, sql });
          }
        }
      }
    }

    const ok = copyDiffs.length === 0 && judgeDiffs.length === 0;
    return NextResponse.json({
      ok,
      checked: {
        documents: docs.length,
        memberOnlyDocuments: memberDocs.length,
        members: memberIds.length,
        pairs,
      },
      copyDiffCount: copyDiffs.length,
      copyDiffs: copyDiffs.slice(0, MAX_REPORT),
      judgeDiffCount: judgeDiffs.length,
      judgeDiffs,
      note: ok
        ? "差分なし。①メンバーAI相談を検索v2へ切り替えてよい状態です。"
        : "差分があります。解消するまで会員向けの検索v2は有効化しないでください。",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
