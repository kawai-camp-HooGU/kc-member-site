// ============================================================
// メールAPIのアカウント単位認可（サーバー側 enforcement）
//
//   service_role の API Route は RLS を迂回するため、requireOps だけでは
//   「そのアカウントを閲覧/操作してよいか」を検証できない。
//   account_role_access（feature='mailbox', account_type='mail'）を引き、
//   明示的な制限（none / view）を尊重する。
//
//   方針は RLS（migration_add_account_access_rls.sql）と同じ
//   「デフォルト許可・明示的拒否のみ」。行が無ければ許可、管理者は常に許可。
//     ・see     … access==='none' なら拒否
//     ・operate … 明示行があり access!=='operate' なら拒否（none/view を拒否）
//
//   ⚠️ account_role_access は生成済み Database 型に未登録のため untyped で扱う。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { HttpError, type Caller } from "./authz";

/** account_role_access の明示アクセス値（無ければ null）。 */
async function explicitMailAccess(role: string | null, accountId: number): Promise<string | null> {
  if (!role) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("account_role_access")
    .select("access")
    .eq("feature", "mailbox")
    .eq("account_type", "mail")
    .eq("account_id", accountId)
    .eq("role_key", role)
    .maybeSingle();
  return (data?.access as string | undefined) ?? null;
}

/** 指定メールアカウントへの閲覧/操作権限を検証（無ければ 403）。 */
export async function assertMailAccountAccess(me: Caller, accountId: number, mode: "see" | "operate"): Promise<void> {
  if (me.isAdmin) return;
  const access = await explicitMailAccess(me.role, accountId);
  if (access == null) return; // 明示行なし＝許可（デフォルト許可）
  if (mode === "see") {
    if (access === "none") throw new HttpError(403, "このメールアカウントを閲覧する権限がありません");
  } else {
    if (access !== "operate") throw new HttpError(403, "このメールアカウントを操作する権限がありません");
  }
}

/** 指定メール（message id）が属するアカウントへの権限を検証。 */
export async function assertMailMessageAccess(me: Caller, messageId: number, mode: "see" | "operate"): Promise<void> {
  if (me.isAdmin) return;
  const { data } = await supabaseAdmin.from("mail_messages").select("account_id").eq("id", messageId).maybeSingle();
  if (!data) throw new HttpError(404, "メールが見つかりません");
  await assertMailAccountAccess(me, data.account_id, mode);
}

/** 予約（mail_scheduled id）が属するアカウントへの権限を検証。 */
export async function assertScheduledMailAccess(me: Caller, scheduledId: number, mode: "see" | "operate"): Promise<void> {
  if (me.isAdmin) return;
  const { data } = await supabaseAdmin.from("mail_scheduled").select("account_id").eq("id", scheduledId).maybeSingle();
  if (!data) throw new HttpError(404, "予約が見つかりません");
  await assertMailAccountAccess(me, data.account_id, mode);
}

/** 閲覧可能なアカウントだけに絞り込む（予約一覧など横断表示のフィルタ用）。 */
export async function filterAccessibleAccountIds(me: Caller, accountIds: number[]): Promise<Set<number>> {
  const ok = new Set<number>();
  const uniq = Array.from(new Set(accountIds));
  await Promise.all(uniq.map(async (id) => {
    try { await assertMailAccountAccess(me, id, "see"); ok.add(id); } catch { /* 拒否は除外 */ }
  }));
  return ok;
}
