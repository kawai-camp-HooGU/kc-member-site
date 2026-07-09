import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { errMessage } from "../../../lib/errors";
import type { TablesInsert } from "../../../lib/database.types";

interface InviteBody {
  email?: string; name?: string; role?: string;
  company?: string | null; chatId?: string | null; memberId?: number | null;
}

export async function POST(request: Request) {
  try {
    const { email, name, role, company, chatId, memberId } = (await request.json()) as InviteBody;

    if (!email || !name || !role) {
      return NextResponse.json({ error: "email, name, role は必須です" }, { status: 400 });
    }

    // ── 権限チェック：呼び出し元の検証 ──
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    }
    const { data: meRows } = await supabaseAdmin
      .from("members").select("role").eq("user_id", callerData.user.id).eq("is_deleted", false).limit(1);
    const callerRole = meRows?.[0]?.role;
    if (callerRole !== "管理者" && callerRole !== "リーダー") {
      return NextResponse.json({ error: "招待する権限がありません" }, { status: 403 });
    }
    if (callerRole === "リーダー" && role === "管理者") {
      return NextResponse.json({ error: "リーダーは管理者ロールで招待できません" }, { status: 403 });
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
    const memberRow: TablesInsert<"members"> = {
      name,
      role: role as TablesInsert<"members">["role"],
      email,
      user_id: userId,
      company: company ?? null,
      chat_id: chatId ?? null,
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
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

interface PendingMember {
  user_id: string | null; name: string | null; company: string | null;
  role: string | null; chat_id: string | null; email: string | null;
}

// 招待中（招待済みだがパスワード未設定）の一覧を返す
export async function GET() {
  try {
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
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

interface DeleteBody { userId?: string; }

// 招待の取り消し：members 行 → auth.users の順で削除
export async function DELETE(request: Request) {
  try {
    const { userId } = (await request.json()) as DeleteBody;
    if (!userId) {
      return NextResponse.json({ error: "userId は必須です" }, { status: 400 });
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
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
