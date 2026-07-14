// ============================================================
// メンバーの削除（2モード）
//
//   GET  /api/members/delete?memberId=12   … 影響件数（確認ダイアログ用）
//   POST /api/members/delete  { memberId, mode }
//
//   mode = "deactivate" … 利用停止（履歴を残す）
//     ・Supabase Auth のユーザーを削除 → ログイン不可／同じメールで再招待できる
//     ・members 行は is_deleted=true で残す（user_id は NULL に戻す）
//     ・チャット・フォーム回答・属性・視聴ログは残る（分析が壊れない）
//     ・復元可能（is_deleted を戻し、再招待すればよい）
//
//   mode = "purge" … 完全削除
//     ・members 行を物理削除。参照先は FK で連鎖処理される
//         cascade  : member_attributes / chat_conversations / chat_messages /
//                    content_views / action_events / scenario_entries / push_subscriptions
//         set null : form_submissions.member_id（回答は匿名の回答として残る）
//                    tasks.assignee_id / projects.leader_id（担当が外れるだけ）
//     ・Auth ユーザーも削除
//     ・復元不可
//
//   ⚠️ auth.users の削除には service_role が要る。ブラウザ（anon key）からは実行できない。
//   ⚠️ ガード：自分自身は削除不可／オペレーターは管理者を削除不可。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";

export type DeleteMode = "deactivate" | "purge";

interface Body { memberId?: number; mode?: DeleteMode }

/** 対象を引き、権限を検証して返す（GET/POST 共通） */
async function loadTarget(request: Request, memberId: number) {
  const caller = await requireOps(request);
  if (caller.memberId === memberId) throw new HttpError(400, "自分自身は削除できません");

  const { data: target, error } = await supabaseAdmin
    .from("members").select("id, name, role, user_id").eq("id", memberId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!target) throw new HttpError(404, "対象のメンバーが見つかりません");
  if (!caller.isAdmin && target.role === "管理者") {
    throw new HttpError(403, "オペレーターは管理者を削除できません");
  }
  return target;
}

// ── 影響件数（完全削除で何が消えるかをダイアログに出す）──────────
export async function GET(request: Request) {
  try {
    const memberId = Number(new URL(request.url).searchParams.get("memberId"));
    if (!memberId) throw new HttpError(400, "memberId は必須です");
    const target = await loadTarget(request, memberId);

    const count = async (
      table: "chat_messages" | "form_submissions" | "member_attributes" | "content_views",
      col: string,
      value: number,
    ): Promise<number> => {
      const { count: n } = await supabaseAdmin
        .from(table).select("*", { count: "exact", head: true }).eq(col, value);
      return n ?? 0;
    };

    // チャットは会話にぶら下がるので、まず会話IDを引く
    const { data: conv } = await supabaseAdmin
      .from("chat_conversations").select("id").eq("member_id", memberId).maybeSingle();
    const chats = conv ? await count("chat_messages", "conversation_id", conv.id) : 0;

    return NextResponse.json({
      name: target.name,
      hasAuth: target.user_id != null,
      chats,
      submissions: await count("form_submissions", "member_id", memberId),
      attributes: await count("member_attributes", "member_id", memberId),
      views:      await count("content_views", "member_id", memberId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// ── 実行 ──────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { memberId, mode } = (await request.json()) as Body;
    if (memberId == null) throw new HttpError(400, "memberId は必須です");
    if (mode !== "deactivate" && mode !== "purge") throw new HttpError(400, "mode が不正です");

    const target = await loadTarget(request, memberId);

    // ① Auth ユーザーの削除（両モード共通。ログインを止めるのが削除の本質）
    if (target.user_id) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(target.user_id);
      if (error) throw new HttpError(500, `認証ユーザーの削除に失敗しました: ${error.message}`);
    }

    if (mode === "deactivate") {
      // ② 履歴は残す。user_id は消えた auth ユーザーを指し続けないよう NULL に戻す。
      const { error } = await supabaseAdmin
        .from("members").update({ is_deleted: true, user_id: null }).eq("id", memberId);
      if (error) throw new HttpError(500, `利用停止に失敗しました: ${error.message}`);
      return NextResponse.json({ success: true, mode });
    }

    // ② 物理削除（参照先は FK の cascade / set null で処理される）
    const { error } = await supabaseAdmin.from("members").delete().eq("id", memberId);
    if (error) throw new HttpError(500, `完全削除に失敗しました: ${error.message}`);
    return NextResponse.json({ success: true, mode });
  } catch (err) {
    return errorResponse(err);
  }
}
