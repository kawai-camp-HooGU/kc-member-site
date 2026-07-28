// ============================================================
// LINEアカウント管理（service_role / サーバー専用）
//   ・追加/編集/削除（非秘密は line_accounts、秘密は line_account_secrets に暗号化）
//   ・接続テスト（getBotInfo ＋ Webhook疎通）
//   ・Webhook/送信/cron 向けの資格情報の解決（復号）
//   ⚠️ クライアントから import しないこと（復号鍵・service_role を扱う）。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import type { Database } from "./database.types";
import { encryptSecret, decryptSecret } from "./lineCrypto";
import { getBotInfo, testWebhookEndpoint } from "./lineClient";
import { errMessage } from "./errors";

// ── 資格情報の解決（Webhook/送信/cron）──────────────────────
export interface WebhookContext { accountId: number; channelSecret: string; accessToken: string }

/** channel_id（Webhook URL 末尾）からアカウントと復号済み資格情報を得る。 */
export async function getWebhookContext(channelId: string): Promise<WebhookContext | null> {
  const { data: acc } = await supabaseAdmin
    .from("line_accounts")
    .select("id, status")
    .eq("channel_id", channelId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (!acc || acc.status === "paused") return null;
  const creds = await getAccountCreds(acc.id);
  if (!creds) return null;
  return { accountId: acc.id, channelSecret: creds.channelSecret, accessToken: creds.accessToken };
}

/** アカウントの復号済み資格情報。 */
export async function getAccountCreds(
  accountId: number
): Promise<{ channelSecret: string; accessToken: string } | null> {
  const { data: sec } = await supabaseAdmin
    .from("line_account_secrets")
    .select("channel_secret_cipher, access_token_cipher")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!sec) return null;
  try {
    return {
      channelSecret: decryptSecret(sec.channel_secret_cipher),
      accessToken: decryptSecret(sec.access_token_cipher),
    };
  } catch (e) {
    console.error("getAccountCreds decrypt error:", errMessage(e));
    return null;
  }
}

/** 送信用：アクセストークンだけ復号して返す。 */
export async function getAccessToken(accountId: number): Promise<string | null> {
  const creds = await getAccountCreds(accountId);
  return creds?.accessToken ?? null;
}

/** cron 対象（有効・停止でない）アカウントID一覧。 */
export async function listActiveAccountIds(): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("line_accounts")
    .select("id")
    .eq("is_deleted", false)
    .neq("status", "paused");
  return (data ?? []).map((r) => r.id);
}

/** 受信を観測したら last_received_at を更新（webhook から呼ぶ）。 */
export async function markAccountReceived(accountId: number): Promise<void> {
  await supabaseAdmin
    .from("line_accounts")
    .update({ last_received_at: new Date().toISOString() })
    .eq("id", accountId);
}

// ── CRUD ──────────────────────────────────────────────────────
export interface CreateAccountInput {
  name: string;
  channelId: string;
  env: "prod" | "test";
  channelSecret: string;
  accessToken: string;
  notes?: string;
  liffId?: string;
}

export async function createAccount(input: CreateAccountInput): Promise<{ id: number } | null> {
  const { data: acc, error } = await supabaseAdmin
    .from("line_accounts")
    .insert({
      name: input.name,
      channel_id: input.channelId,
      env: input.env,
      notes: input.notes ?? "",
      liff_id: input.liffId ?? "",
      status: "needs_action",
    })
    .select("id")
    .single();
  if (error || !acc) {
    console.error("createAccount error:", error?.message);
    throw new Error(error?.message ?? "アカウントの作成に失敗しました");
  }
  const { error: sErr } = await supabaseAdmin.from("line_account_secrets").insert({
    account_id: acc.id,
    channel_secret_cipher: encryptSecret(input.channelSecret),
    access_token_cipher: encryptSecret(input.accessToken),
  });
  if (sErr) {
    // 秘密の保存に失敗したらアカウント行も戻す（不整合を残さない）
    await supabaseAdmin.from("line_accounts").delete().eq("id", acc.id);
    throw new Error("認証情報の保存に失敗しました");
  }
  return { id: acc.id };
}

export interface UpdateAccountInput {
  name?: string;
  env?: "prod" | "test";
  status?: "connected" | "needs_action" | "paused";
  notes?: string;
  liffId?: string;
  /** 再登録する場合のみ。空/未指定なら既存を維持。 */
  channelSecret?: string;
  accessToken?: string;
}

export async function updateAccount(id: number, patch: UpdateAccountInput): Promise<void> {
  const meta: Database["public"]["Tables"]["line_accounts"]["Update"] = {};
  if (patch.name != null) meta.name = patch.name;
  if (patch.env != null) meta.env = patch.env;
  if (patch.status != null) meta.status = patch.status;
  if (patch.notes != null) meta.notes = patch.notes;
  if (patch.liffId != null) meta.liff_id = patch.liffId;
  if (Object.keys(meta).length > 0) {
    await supabaseAdmin.from("line_accounts").update(meta).eq("id", id);
  }
  const sec: Database["public"]["Tables"]["line_account_secrets"]["Update"] = {};
  if (patch.channelSecret) sec.channel_secret_cipher = encryptSecret(patch.channelSecret);
  if (patch.accessToken) sec.access_token_cipher = encryptSecret(patch.accessToken);
  if (patch.channelSecret || patch.accessToken) {
    sec.updated_at = new Date().toISOString();
    await supabaseAdmin.from("line_account_secrets").update(sec).eq("account_id", id);
  }
}

export async function softDeleteAccount(id: number): Promise<void> {
  await supabaseAdmin.from("line_accounts").update({ is_deleted: true }).eq("id", id);
}

// ── 接続テスト ────────────────────────────────────────────────
export interface ConnectionTestResult {
  ok: boolean;
  botInfoOk: boolean;
  webhookOk: boolean;
  basicId: string;
  botUserId: string;
  detail: string;
}

export async function testConnection(id: number): Promise<ConnectionTestResult> {
  const creds = await getAccountCreds(id);
  if (!creds) {
    await setStatus(id, "needs_action", "認証情報が未登録です");
    return { ok: false, botInfoOk: false, webhookOk: false, basicId: "", botUserId: "", detail: "認証情報が未登録です" };
  }

  let botInfoOk = false, basicId = "", botUserId = "", pictureUrl = "";
  try {
    const info = await getBotInfo(creds.accessToken);
    botInfoOk = true;
    basicId = info.basicId;
    botUserId = info.userId;
    pictureUrl = info.pictureUrl;
  } catch (e) {
    await setStatus(id, "needs_action", `アクセストークンが無効です: ${errMessage(e)}`);
    return { ok: false, botInfoOk: false, webhookOk: false, basicId: "", botUserId: "", detail: errMessage(e) };
  }

  let webhookOk = false, webhookReason = "";
  try {
    const wh = await testWebhookEndpoint(creds.accessToken);
    webhookOk = wh.ok;
    webhookReason = wh.ok ? "" : `Webhook疎通に失敗 (${wh.statusCode}) ${wh.reason}`;
  } catch (e) {
    webhookReason = `Webhook疎通に失敗: ${errMessage(e)}`;
  }

  const now = new Date().toISOString();
  const status = botInfoOk && webhookOk ? "connected" : "needs_action";
  const detail = status === "connected" ? "接続OK" : (webhookReason || "Webhook設定を確認してください");
  await supabaseAdmin
    .from("line_accounts")
    .update({
      basic_id: basicId,
      bot_user_id: botUserId,
      picture_url: pictureUrl || null,
      status,
      status_detail: detail,
      last_test_at: now,
      webhook_verified_at: webhookOk ? now : null,
    })
    .eq("id", id);

  return { ok: status === "connected", botInfoOk, webhookOk, basicId, botUserId, detail };
}

async function setStatus(id: number, status: string, detail: string): Promise<void> {
  await supabaseAdmin
    .from("line_accounts")
    .update({ status, status_detail: detail, last_test_at: new Date().toISOString() })
    .eq("id", id);
}
