// ============================================================
// API Route 共通の認可ヘルパー（Phase 0）
//
//   supabaseAdmin（service_role）は RLS を無視して全データにアクセスできる。
//   そのため service_role を使う API Route は、必ず「呼び出し元が誰か」を
//   検証しなければならない。その検証をここに一元化する。
//
//   使い方（route.ts の先頭）:
//     export async function POST(request: Request) {
//       try {
//         const me = await requireOps(request);   // ← 403 ならここで throw
//         ...
//       } catch (err) {
//         return errorResponse(err);              // ← 401/403/500 を返す
//       }
//     }
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabaseAdmin";
import { errMessage } from "./errors";
import type { MemberRole } from "./database.types";

/** ステータスコードを持つエラー。errorResponse() で HTTP レスポンスに変換する。 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** 呼び出し元の識別情報 */
export interface Caller {
  userId: string;
  memberId: number | null;
  role: MemberRole | null;
  /** 管理者 or オペレーター */
  isOps: boolean;
  /** 管理者 */
  isAdmin: boolean;
}

/**
 * 運営ロール（システム固定分）。
 *
 * ⚠️ これに加えて「オペレーターの派生ロール」も運営として扱う。
 *    派生かどうかは roles.base_role で判定する（requireUser 内の JOIN 参照）。
 *    lib/roles.ts のキャッシュはクライアント側専用のため、
 *    サーバー（API Route）では使わずに DB を直接引くこと。
 */
const OPS_ROLES: readonly string[] = ["管理者", "オペレーター"];

/** 派生元にできる唯一のロール（DB の derived_must_be_operator と対）*/
const BASE_ROLE = "オペレーター";

/** システム固定ロール。これに一致すれば roles を引く必要がない */
const SYSTEM_ROLES: readonly string[] = ["管理者", "オペレーター", "メンバー", "外部"];

/** Authorization: Bearer <token> からトークンを取り出す */
function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * ログイン済みであることだけを要求する。
 * members 行が無いユーザー（＝招待されていない）も通す点に注意。
 * 会員向けの API で使う。
 */
export async function requireUser(request: Request): Promise<Caller> {
  const token = bearer(request);
  if (!token) throw new HttpError(401, "認証が必要です");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "認証に失敗しました");

  const { data: rows } = await supabaseAdmin
    .from("members")
    .select("id, role")
    .eq("user_id", data.user.id)
    .eq("is_deleted", false)
    .limit(1);

  const row = rows?.[0];
  const role = (row?.role ?? null) as MemberRole | null;

  // 運営判定：まずシステム固定ロールで判定し、該当しなければ
  // ロールマスタを引いて「オペレーターの派生ロール」かを確かめる。
  //   ⚠️ 追加クエリが走るのは派生ロールのときだけ（主キー1件の参照）。
  //      システム固定4ロールはこの時点で確定するので、通常の API 呼び出しに
  //      オーバーヘッドは発生しない。
  let isOps = role != null && OPS_ROLES.includes(role);
  if (!isOps && role != null && !SYSTEM_ROLES.includes(role)) {
    const { data: r } = await supabaseAdmin
      .from("roles")
      .select("base_role")
      .eq("key", role)
      .maybeSingle();
    isOps = r?.base_role === BASE_ROLE;
  }

  return {
    userId: data.user.id,
    memberId: row?.id ?? null,
    role,
    isOps,
    isAdmin: role === "管理者",
  };
}

/**
 * ログイン済み かつ members 行があることを要求する。
 * 「招待されていないのにサインアップだけした」ユーザーを弾く。
 */
export async function requireMember(request: Request): Promise<Caller> {
  const me = await requireUser(request);
  if (me.memberId == null) throw new HttpError(403, "メンバー登録がありません");
  return me;
}

/** 運営（管理者・オペレーター）であることを要求する。 */
export async function requireOps(request: Request): Promise<Caller> {
  const me = await requireUser(request);
  if (!me.isOps) throw new HttpError(403, "この操作の権限がありません");
  return me;
}

/** 管理者であることを要求する。 */
export async function requireAdmin(request: Request): Promise<Caller> {
  const me = await requireUser(request);
  if (!me.isAdmin) throw new HttpError(403, "管理者権限が必要です");
  return me;
}

/**
 * Vercel Cron からの呼び出しであることを要求する（fail-closed）。
 * CRON_SECRET が未設定なら「誰でも叩ける」ではなく「誰も叩けない」にする。
 */
export function requireCron(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HttpError(500, "CRON_SECRET が未設定です（環境変数を設定してください）");
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new HttpError(401, "unauthorized");
  }
}

/** HttpError を HTTP レスポンスに変換する。それ以外は 500。 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: errMessage(err) }, { status: 500 });
}
