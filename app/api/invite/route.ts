import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireOps, errorResponse, HttpError } from "../../../lib/authz";
import type { TablesInsert } from "../../../lib/database.types";

interface InviteBody {
  email?: string; name?: string; role?: string;
  company?: string | null; chatId?: string | null; memberId?: number | null;
  /**
   * Phase 3：流入経路。自由テキスト（source）→ マスタ参照（sourceId）に変更。
   *   これでタイポ（seminer / seminar）による孤児レコードが生まれなくなる。
   */
  sourceId?: number | null;
}

export async function POST(request: Request) {
  try {
    // ── 権限チェック：運営（管理者・オペレーター）のみ ──
    const caller = await requireOps(request);

    const { email, name, role, company, chatId, memberId, sourceId } = (await request.json()) as InviteBody;

    if (!email || !name || !role) {
      throw new HttpError(400, "email, name, role は必須です");
    }
    if (!caller.isAdmin && role === "管理者") {
      throw new HttpError(403, "オペレーターは管理者ロールで招待できません");
    }

    // ① 招待メールを送信（クリック後 /set-password へリダイレクト）
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: name },
      redirectTo: `${siteUrl}/set-password`,
    });

    if (inviteError || !inviteData?.user) {
      return NextResponse.json({ error: inviteError?.message ?? "招待に失敗しました" }, { status: 400 });
    }

    const userId = inviteData.user.id;

    // ② members テーブルに登録
    const now = new Date().toISOString();
    const memberRow: TablesInsert<"members"> = {
      name,
      role: role as TablesInsert<"members">["role"],
      email,
      user_id: userId,
      company: company ?? null,
      chat_id: chatId ?? null,
      // Phase 3：初回流入＝最新流入として記録（招待は「最初の接触」とみなす）
      source_id: sourceId ?? null,
      last_source_id: sourceId ?? null,
      source_at: sourceId != null ? now : null,
    };

    if (memberId != null) {
      memberRow.id = memberId;
    } else {
      const { data: existing, error: findError } = await supabaseAdmin
        .from("members")
        .select("id")
        .eq("name", name)
        .eq("is_deleted", false)
        .maybeSingle();

      if (findError) {
        return NextResponse.json({ error: findError.message }, { status: 500 });
      }
      if (existing) memberRow.id = existing.id;
    }

    const { error: upsertError } = await supabaseAdmin
      .from("members")
      .upsert(memberRow, { onConflict: "id" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, userId });
  } catch (err) {
    return errorResponse(err);
  }
}

interface PendingMember {
  user_id: string | null; name: string | null; company: string | null;
  role: string | null; chat_id: string | null; email: string | null;
}

// 招待中（招待済みだがパスワード未設定）の一覧を返す
export async function GET(request: Request) {
  try {
    // ── 権限チェック：運営のみ（未認証だと全招待者のメール・氏名・会社が漏れる） ──
    await requireOps(request);

    const pendingUsers: import("@supabase/supabase-js").User[] = [];
    const perPage = 1000;
    for (let page = 1; ; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const users = data?.users ?? [];
      for (const u of users) {
        const confirmed = u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at;
        if (u.invited_at && !confirmed) pendingUsers.push(u);
      }
      if (users.length < perPage) break;
    }

    const userIds = pendingUsers.map((u) => u.id);
    const membersById: Record<string, PendingMember> = {};
    if (userIds.length > 0) {
      const { data: memberRows, error: mErr } = await supabaseAdmin
        .from("members")
        .select("user_id, name, company, role, chat_id, email")
        .in("user_id", userIds);
      if (mErr) {
        return NextResponse.json({ error: mErr.message }, { status: 500 });
      }
      for (const m of memberRows ?? []) {
        if (m.user_id) membersById[m.user_id] = m;
      }
    }

    const invites = pendingUsers
      .map((u) => {
        const m = membersById[u.id];
        const meta = (u.user_metadata ?? {}) as { display_name?: string };
        return {
          userId:    u.id,
          invitedAt: u.invited_at,
          email:     u.email ?? m?.email ?? "",
          name:      m?.name ?? meta.display_name ?? "",
          company:   m?.company ?? "",
          role:      m?.role ?? "",
          chatId:    m?.chat_id ?? "",
        };
      })
      .sort((a, b) => (b.invitedAt ?? "").localeCompare(a.invitedAt ?? ""));

    return NextResponse.json({ invites });
  } catch (err) {
    return errorResponse(err);
  }
}

interface DeleteBody { userId?: string; }

// 招待の取り消し：members 行 → auth.users の順で削除
export async function DELETE(request: Request) {
  try {
    // ── 権限チェック：運営のみ ──
    //   未認証だと、userId を知る第三者が任意のアカウントを削除できてしまう。
    const caller = await requireOps(request);

    const { userId } = (await request.json()) as DeleteBody;
    if (!userId) {
      throw new HttpError(400, "userId は必須です");
    }
    if (userId === caller.userId) {
      throw new HttpError(400, "自分自身の招待は取り消せません");
    }

    // 取り消せるのは「招待済みだが未確認」のユーザーのみ。
    // 稼働中アカウントの誤削除・悪用を防ぐ。
    const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !target?.user) {
      throw new HttpError(404, "対象のユーザーが見つかりません");
    }
    const u = target.user;
    const confirmed = u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at;
    if (!u.invited_at || confirmed) {
      throw new HttpError(400, "招待中のユーザーではないため取り消せません");
    }

    // オペレーターは管理者ロールの招待を取り消せない
    const { data: targetRows } = await supabaseAdmin
      .from("members").select("role").eq("user_id", userId).limit(1);
    if (!caller.isAdmin && targetRows?.[0]?.role === "管理者") {
      throw new HttpError(403, "オペレーターは管理者の招待を取り消せません");
    }

    const { error: delMemberError } = await supabaseAdmin
      .from("members")
      .delete()
      .eq("user_id", userId);
    if (delMemberError) {
      return NextResponse.json({ error: delMemberError.message }, { status: 500 });
    }

    const { error: delUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (delUserError) {
      return NextResponse.json({ error: delUserError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
