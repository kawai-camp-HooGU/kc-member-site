// ============================================================
// トークのブックマーク：登録／AI再生成（運営のみ）
//   action="create"     … 原文＋ジャンルを受け取り、AIで各項目を生成して保存
//   action="regenerate" … 既存の原文＋ジャンルから各項目を作り直す
//   ⚠️ 一覧／手修正／削除はクライアントから RLS(運営) で直接更新する（lib/bookmarks.ts）。
// ============================================================
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../lib/authz";
import { generateBookmarkFields } from "../../../lib/ai/bookmarkGen";

const sb = supabaseAdmin as unknown as SupabaseClient;

interface Body {
  action?: "create" | "regenerate";
  id?: number;
  sourceMessageId?: number;
  sourceConversationId?: number;
  sourceMemberId?: number | null;
  sourceMessageAt?: string | null;
  originalText?: string;
  genre?: string;
}

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as Body;

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
        formatted_reply: gen.formatted_reply, ai_pending: false,
      }).eq("id", b.id);
      if (error) throw new HttpError(500, error.message);
      return NextResponse.json({ ok: true });
    }

    // ── 登録 ──
    if (!b.originalText?.trim() || !b.genre?.trim()) {
      throw new HttpError(400, "originalText と genre は必須です");
    }
    // 同一メッセージが既にブックマーク済みなら重複させない
    if (b.sourceMessageId != null) {
      const { data: dup } = await sb.from("chat_bookmarks")
        .select("id").eq("source_message_id", b.sourceMessageId).eq("is_deleted", false).maybeSingle();
      if (dup) return NextResponse.json({ ok: true, id: (dup as { id: number }).id, duplicated: true });
    }

    let gen = { expected_question: "", keywords: [] as string[], formatted_reply: "" };
    let pending = false;
    try {
      gen = await generateBookmarkFields(b.originalText, b.genre, me.memberId);
    } catch (e) {
      console.error("bookmark generate error:", e);
      pending = true; // 生成に失敗しても登録は通す（一覧で「要確認」表示 → 再生成/手入力）
    }

    const { data, error } = await sb.from("chat_bookmarks").insert({
      source_message_id: b.sourceMessageId ?? null,
      source_conversation_id: b.sourceConversationId ?? null,
      source_member_id: b.sourceMemberId ?? null,
      source_message_at: b.sourceMessageAt ?? null,
      genre: b.genre,
      original_text: b.originalText,
      expected_question: gen.expected_question,
      keywords: gen.keywords,
      formatted_reply: gen.formatted_reply,
      ai_pending: pending,
      created_by: me.memberId,
    }).select("id").single();
    if (error) throw new HttpError(500, error.message);

    return NextResponse.json({ ok: true, id: (data as { id: number }).id });
  } catch (err) {
    return errorResponse(err);
  }
}
