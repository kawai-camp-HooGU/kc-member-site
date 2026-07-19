// ============================================================
// ロールマスタ（サーバー専用・service role）
//
//   lib/roles.ts のモジュールキャッシュはクライアント側専用。
//   配信エンジン・シナリオエンジン・AI コンテキスト構築は
//   ユーザーのセッションを持たないため、service role で読む。
//
//   ⚠️ supabaseAdmin は RLS を無視する。呼び出し元の検証は
//      各 API Route の requireOps()/requireCron() 側で必ず行うこと。
//
//   ⚠️ ここで解決した「運営ロール集合」を配信対象の除外に使う。
//      派生ロールを取りこぼすと、運営スタッフが一斉配信の宛先や
//      AI コンテキストに会員として混入する。
// ============================================================
//   ⚠️ lib/roles.ts はブラウザ用 supabase クライアントを import するため、
//      サーバー専用モジュールから引き込まないよう定数はここに複製する。
import { supabaseAdmin } from "./supabaseAdmin";
import { registerOpsRoles } from "./zone";

/** 派生元にできる唯一のロール（lib/roles.ts の BASE_ROLE と同値）*/
const BASE_ROLE = "オペレーター";

/** システム固定の運営ロール（roles 未適用環境でのフォールバック）*/
const SYSTEM_STAFF: readonly string[] = ["管理者", BASE_ROLE];

/**
 * 運営側ロールキーの集合を返す。
 *   管理者 / オペレーター ＋ オペレーターの派生ロール
 *
 * roles テーブルが未作成（マイグレーション未適用）の場合は
 * システム固定2ロールにフォールバックし、従来どおりの挙動を保つ。
 */
export async function loadStaffRoleKeys(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("key, base_role");

  if (error || !data || data.length === 0) {
    registerOpsRoles([]);
    return new Set(SYSTEM_STAFF);
  }

  const derived: string[] = [];
  const out = new Set<string>(SYSTEM_STAFF);
  for (const r of data as { key: string; base_role: string | null }[]) {
    if (r.base_role === BASE_ROLE) { out.add(r.key); derived.push(r.key); }
  }
  // lib/zone.ts の isOpsRole（contentsServer 等が使う）へ派生ロールを反映する
  registerOpsRoles(derived);
  return out;
}
