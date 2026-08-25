// ============================================================
// トークのブックマーク：下見／登録／AI再生成（運営のみ）
//   action="preview"    … 原文＋ジャンルから各項目を生成するだけ（保存しない）＋重複候補を返す
//   action="create"     … 原文＋ジャンルを受け取り、AIで各項目を生成して保存
//   action="regenerate" … 既存の原文＋ジャンルから各項目を作り直す
//   ⚠️ 一覧／手修正／削除／承認はクライアントから RLS(運営) で直接更新する（lib/bookmarks.ts）。
//
//   REQ-032（2026-08-25）で変わったこと
//     ・publishScope（公開範囲）を受け取り、既定は最も狭い ops_only
//     ・新規登録は review_status='draft'（承認して初めて索引に入る）
//     ・保存前に maskText() を通す（メール・電話を残さない）
//     ・segments で複数件に分けて登録できる
//     ・replaceId を渡すと、置き換え元を archived にして後継を指す
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../lib/authz";
import { generateBookmarkFields } from "../../../lib/ai/bookmarkGen";
import type { BookmarkGen } from "../../../lib/ai/bookmarkGen";
import { maskText } from "../../../lib/ai-core/guardrails/pii";
import { findSimilarBookmarks } from "../../../lib/ai/context";

const sb = supabaseAdmin as unknown as SupabaseClient;

type PublishScope = "ops_only" | "member" | "public";
const SCOPES: readonly PublishScope[] = ["ops_only", "member", "public"];
const toScope = (v: unknown): PublishScope =>
  (SCOPES as readonly string[]).includes(String(v)) ? (v as PublishScope) : "ops_only";

interface SegmentIn { topic?: string; question?: string; answer?: string }

interface Body {
  action?: "preview" | "create" | "regenerate";
  id?: number;
  /** 'app'（アプリ内トーク・既定）/ 'line'（LINEトーク） */
  channel?: "app" | "line";
  sourceMessageId?: number;
  sourceConversationId?: number;
  /** LINE：line_messages.id（内部ID） */
  sourceLineMessageId?: number;
  sourceMemberId?: number | null;
  sourceMessageAt?: string | null;
  originalText?: string;
  genre?: string;
  /** 公開範囲。未指定は ops_only（最も狭い側へ倒す） */
  publishScope?: string;
  /** 分割して登録するとき。空・未指定なら1件で登録 */
  segments?: SegmentIn[];
  /**
   * 下見（action="preview"）で得た生成結果。渡ってきたら再生成しない。
   * ⚠️ クライアントが中身を決められるが、この画面の利用者は運営であり、
   *    登録後に RLS で同じ項目を自由に編集できる。ここで拒む意味がないので受け取る。
   *    （AI生成の回数を1登録あたり1回に抑えるための経路）
   */
  gen?: {
    expected_question?: string; keywords?: string[]; formatted_reply?: string;
    variables?: { name: string; example: string; kind: string }[];
  };
  /** 重複を置き換えるとき、置き換え元のID */
  replaceId?: number;
}

const EMPTY_GEN: BookmarkGen = {
  expected_question: "", keywords: [], formatted_reply: "", variables: [], segments: [],
};

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as Body;

    // ── 下見（保存しない）──
    //   登録前に「分割候補・差し込み変数・重複」を運営に見せるための経路。
    //   生成に失敗したらエラーを返す。呼び出し側は下見なしで登録できる。
    if (b.action === "preview") {
      if (!b.originalText?.trim() || !b.genre?.trim()) {
        throw new HttpError(400, "originalText と genre は必須です");
      }
      const [gen, duplicates] = await Promise.all([
        generateBookmarkFields(b.originalText, b.genre, me.memberId),
        findSimilarBookmarks(b.originalText),
      ]);
      return NextResponse.json({ ok: true, gen, duplicates });
    }

    // ── AI再生成 ──
    if (b.action === "regenerate") {
      if (b.id == null) throw new HttpError(400, "id は必須です");
      const { data } = await sb.from("chat_bookmarks")
        .select("original_text, genre").eq("id", b.id).maybeSingle();
      const row = data as { original_text: string; genre: string } | null;
      if (!row) throw new HttpError(404, "ブックマークが見つかりません");
      const gen = await generateBookmarkFields(row.original_text, row.genre, me.memberId);
      const { error } = await sb.from("chat_bookmarks").update({
        expected_question: gen.expected_question, keywords: gen.keywords,
        formatted_reply: gen.formatted_reply, variables: gen.variables, ai_pending: false,
      }).eq("id", b.id);
      if (error) throw new HttpError(500, error.message);
      return NextResponse.json({ ok: true });
    }

    // ── 登録 ──
    if (!b.originalText?.trim() || !b.genre?.trim()) {
      throw new HttpError(400, "originalText と genre は必須です");
    }
    const isLine = b.channel === "line";
    // 同一メッセージが既にブックマーク済みなら重複させない
    if (isLine && b.sourceLineMessageId != null) {
      const { data: dup } = await sb.from("chat_bookmarks")
        .select("id").eq("source_channel", "line").eq("source_line_message_id", b.sourceLineMessageId)
        .eq("is_deleted", false).maybeSingle();
      if (dup) return NextResponse.json({ ok: true, ids: [(dup as { id: number }).id], duplicated: true });
    } else if (!isLine && b.sourceMessageId != null) {
      const { data: dup } = await sb.from("chat_bookmarks")
        .select("id").eq("source_message_id", b.sourceMessageId).eq("is_deleted", false).maybeSingle();
      if (dup) return NextResponse.json({ ok: true, ids: [(dup as { id: number }).id], duplicated: true });
    }

    // ⚠️ 保存する原文はマスク後（REQ-032 確認事項4a）。
    //    ここを生のままにすると、顧客の連絡先が chat_bookmarks に無期限で残る。
    const originalText = maskText(b.originalText);
    const scope = toScope(b.publishScope);

    // 生成結果の入手。下見済みなら再生成しない（1登録につきAI呼び出しは1回まで）。
    let gen: BookmarkGen = EMPTY_GEN;
    let pending = false;
    // ⚠️ 失敗理由を握り潰さない。登録は通すが、なぜ空なのかを呼び出し元へ必ず返す。
    let aiError: string | null = null;
    if (b.gen) {
      gen = {
        expected_question: (b.gen.expected_question ?? "").trim(),
        keywords: (b.gen.keywords ?? []).filter((k) => typeof k === "string").slice(0, 8),
        formatted_reply: maskText((b.gen.formatted_reply ?? "").trim()),
        variables: b.gen.variables ?? [],
        segments: [],
      };
    } else {
      try {
        gen = await generateBookmarkFields(originalText, b.genre, me.memberId);
      } catch (e) {
        console.error("bookmark generate error:", e);
        pending = true; // 生成に失敗しても登録は通す（一覧で「要確認」表示 → 再生成/手入力）
        aiError = e instanceof HttpError ? e.message : (e as Error)?.message ?? "AI生成に失敗しました";
      }
    }

    // 登録する行の中身を組み立てる。
    //   ・分割あり … segment ごとに1行（想定質問・案内文は segment のもの）
    //   ・分割なし … 生成結果そのまま1行
    const given = (b.segments ?? []).filter((s) => (s.answer ?? "").trim() !== "");
    const items = given.length > 0
      ? given.map((s) => ({
          expected_question: (s.question ?? s.topic ?? "").trim(),
          keywords: gen.keywords,
          formatted_reply: maskText((s.answer ?? "").trim()),
        }))
      : [{
          expected_question: gen.expected_question,
          keywords: gen.keywords,
          formatted_reply: gen.formatted_reply,
        }];

    const base = {
      source_channel: isLine ? "line" : "app",
      source_message_id: isLine ? null : (b.sourceMessageId ?? null),
      source_line_message_id: isLine ? (b.sourceLineMessageId ?? null) : null,
      source_conversation_id: b.sourceConversationId ?? null,
      source_member_id: b.sourceMemberId ?? null,
      source_message_at: b.sourceMessageAt ?? null,
      genre: b.genre,
      original_text: originalText,
      variables: gen.variables,
      publish_scope: scope,
      // ⚠️ 新規登録は必ず draft。DDLの既定値（approved）は既存行を消さないための値であって、
      //    新規に使う値ではない。ここで明示しないと未確認のまま本番で使われる。
      review_status: "draft",
      ai_pending: pending,
      created_by: me.memberId,
    };

    // ⚠️ 分割で複数行になるとき、source_message_id は先頭の1行にだけ付ける。
    //    同一メッセージの二重登録チェック（上の maybeSingle）が2件目以降で誤検知するため。
    const rows = items.map((it, i) => ({
      ...base,
      ...it,
      source_message_id: i === 0 ? base.source_message_id : null,
      source_line_message_id: i === 0 ? base.source_line_message_id : null,
    }));

    const { data, error } = await sb.from("chat_bookmarks").insert(rows).select("id");
    if (error) throw new HttpError(500, error.message);
    const ids = ((data as { id: number }[] | null) ?? []).map((r) => r.id);

    // 置き換え：元を archived にし、後継を指す（履歴を切らない）
    if (b.replaceId != null && ids.length > 0) {
      await sb.from("chat_bookmarks")
        .update({ review_status: "archived", ai_enabled: false, replaced_by_id: ids[0] })
        .eq("id", b.replaceId);
    }

    return NextResponse.json({ ok: true, ids, aiPending: pending, aiError });
  } catch (err) {
    return errorResponse(err);
  }
}
