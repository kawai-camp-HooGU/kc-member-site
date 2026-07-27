// ============================================================
// LINEアカウント データアクセス（クライアント安全）
//   ・一覧取得（非秘密メタのみ。RLS=運営で直接 supabase）
//   ・追加/編集/削除/接続テストは /api/line/accounts（サーバーで暗号化・LINE呼び出し）
//   ⚠️ シークレット/アクセストークンは取得も表示もしない（サーバー隔離）。
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
import type { Tables } from "./database.types";
import type { LineAccount, LineAccountEnv, LineAccountStatus } from "./models";

const ENVS: LineAccountEnv[] = ["prod", "test"];
const toEnv = (v: string | null | undefined): LineAccountEnv =>
  (ENVS as string[]).includes(v ?? "") ? (v as LineAccountEnv) : "prod";

const STATUSES: LineAccountStatus[] = ["connected", "needs_action", "paused"];
const toStatus = (v: string | null | undefined): LineAccountStatus =>
  (STATUSES as string[]).includes(v ?? "") ? (v as LineAccountStatus) : "needs_action";

export function toLineAccount(r: Tables<"line_accounts">): LineAccount {
  return {
    id: r.id,
    name: r.name ?? "",
    channelId: r.channel_id,
    basicId: r.basic_id ?? "",
    botUserId: r.bot_user_id ?? "",
    pictureUrl: r.picture_url ?? "",
    env: toEnv(r.env),
    status: toStatus(r.status),
    statusDetail: r.status_detail ?? "",
    webhookVerifiedAt: r.webhook_verified_at ?? "",
    lastTestAt: r.last_test_at ?? "",
    lastReceivedAt: r.last_received_at ?? "",
    sortOrder: r.sort_order ?? 0,
  };
}

/** 一覧（削除済みを除く）。非秘密の列だけ取得する。 */
export async function fetchLineAccounts(): Promise<LineAccount[]> {
  const { data, error } = await supabase
    .from("line_accounts")
    .select("id, name, channel_id, basic_id, bot_user_id, picture_url, env, status, status_detail, webhook_verified_at, last_test_at, last_received_at, sort_order, is_deleted, created_at")
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) return [];
  return (data as Tables<"line_accounts">[]).map(toLineAccount);
}

/** アカウントごとの友だち数（有効な友だち）。一覧の表示用。 */
export async function fetchLineFriendCounts(): Promise<Record<number, number>> {
  const map: Record<number, number> = {};
  const { data } = await supabase
    .from("line_friends")
    .select("account_id")
    .eq("status", "friend");
  if (!data) return map;
  for (const r of data) {
    if (r.account_id == null) continue;
    map[r.account_id] = (map[r.account_id] ?? 0) + 1;
  }
  return map;
}

// ── 変更系（サーバー経由）─────────────────────────────────────
export interface CreateInput {
  name: string; channelId: string; env: LineAccountEnv;
  channelSecret: string; accessToken: string;
}
async function post(body: unknown): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const res = await apiFetch("/api/line/accounts", { method: "POST", body });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: unknown };
  if (!res.ok) return { ok: false, error: j.error ?? "処理に失敗しました" };
  return { ok: true, result: j.result };
}

export const createLineAccount = (input: CreateInput) => post({ action: "create", ...input });
export const updateLineAccount = (
  id: number,
  patch: { name?: string; env?: LineAccountEnv; status?: LineAccountStatus; channelSecret?: string; accessToken?: string }
) => post({ action: "update", id, ...patch });
export const deleteLineAccount = (id: number) => post({ action: "delete", id });
export const testLineAccount = (id: number) => post({ action: "test", id });
