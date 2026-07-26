// ============================================================
// メール受信同期（Phase 1・サーバー専用）
//
//   共有メール（問い合わせ窓口）を IMAP で受信し、自前DB（mail_messages）へ
//   キャッシュする。アプリ画面は常にDBだけを読むので、将来 Gmail/Graph API に
//   差し替えても画面は変えなくてよい（＝この層がアダプタ）。
//
//   ⚠️ 秘密情報の扱い（lib/email.ts の SMTP と同じ思想）
//      IMAP のホスト・ユーザ・パスワードは **環境変数** から取得する。
//      DB（mail_accounts）にはメタ情報だけ置き、認証情報は置かない。
//
//   環境変数（アカウントごと）:
//      MAIL_ACCOUNTS = "support,billing"           ← 連携するアカウントのキー（カンマ区切り）
//      MAIL_SUPPORT_ADDRESS   = support@example.jp  ← メールアドレス
//      MAIL_SUPPORT_LABEL     = 問い合わせ窓口       ← 表示名（任意）
//      MAIL_SUPPORT_IMAP_HOST = sv1234.xserver.jp
//      MAIL_SUPPORT_IMAP_PORT = 993                 ← 任意（既定 993）
//      MAIL_SUPPORT_IMAP_USER = support@example.jp  ← 任意（既定は ADDRESS）
//      MAIL_SUPPORT_IMAP_PASS = ********
//      MAIL_SYNC_MAX          = 300                 ← 初回同期で遡る最大件数（任意）
//
//   このモジュールは Node ランタイム専用（net/tls を使う）。呼び出す Route は
//   `export const runtime = "nodejs"` を付けること。
// ============================================================
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { supabaseAdmin } from "./supabaseAdmin";
import { errMessage } from "./errors";
import { encryptSecret, decryptSecret } from "./mailCrypto";
import type { TablesInsert, TablesUpdate } from "./database.types";

// ── アカウント設定（環境変数から解決）────────────────────────
export interface MailConfig {
  key: string;          // 環境変数の接頭辞（例 "SUPPORT"）。mail_accounts.auth_ref に保存
  address: string;
  label: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  shared: boolean;
}

/** 環境変数にメール連携が設定されているか */
export function isMailConfigured(): boolean {
  return (process.env.MAIL_ACCOUNTS ?? "").trim() !== "";
}

/** 遡る最大件数（初回同期のガード）*/
function syncMax(): number {
  const n = Number(process.env.MAIL_SYNC_MAX || 300);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

/** 1キー分の環境変数を読む（必須3点が欠ければ null）。 */
function readEnvConfig(rawKey: string): MailConfig | null {
  const key = rawKey.toUpperCase();
  const address = (process.env[`MAIL_${key}_ADDRESS`] ?? "").trim();
  const host = (process.env[`MAIL_${key}_IMAP_HOST`] ?? "").trim();
  const pass = process.env[`MAIL_${key}_IMAP_PASS`] ?? "";
  if (!address || !host || !pass) return null;
  return {
    key,
    address,
    label: (process.env[`MAIL_${key}_LABEL`] ?? "").trim() || address,
    host,
    port: Number(process.env[`MAIL_${key}_IMAP_PORT`] || 993),
    user: (process.env[`MAIL_${key}_IMAP_USER`] ?? "").trim() || address,
    pass,
    shared: (process.env[`MAIL_${key}_SHARED`] ?? "true").trim() !== "false",
  };
}

/** 環境変数から全アカウント設定を解決する。不備のあるキーは黙って除外する。 */
export function resolveMailConfigs(): MailConfig[] {
  const keys = (process.env.MAIL_ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const out: MailConfig[] = [];
  for (const raw of keys) {
    const cfg = readEnvConfig(raw);
    if (cfg) out.push(cfg);
  }
  return out;
}

// ── 正規化・整形ヘルパー ────────────────────────────────────
/** 突合・保存用にメールアドレスを正規化する（小文字化・前後空白除去）*/
export function normEmail(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** 件名から Re:/Fwd: を剥がしてスレッドキーにする */
function threadKeyOf(subject: string): string {
  return subject.replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "").trim().toLowerCase();
}

/** IMAP の bodyStructure から添付の有無を推定する（本文を落とさずに判定）。 */
function hasAttachmentStructure(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { disposition?: string; childNodes?: unknown[] };
  if ((n.disposition ?? "").toLowerCase() === "attachment") return true;
  if (Array.isArray(n.childNodes)) return n.childNodes.some(hasAttachmentStructure);
  return false;
}

// ── 会員照合マップ ──────────────────────────────────────────
async function loadMemberEmailMap(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from("members")
    .select("id, email")
    .eq("is_deleted", false);
  const map = new Map<string, number>();
  for (const m of data ?? []) {
    const e = normEmail(m.email);
    if (e) map.set(e, m.id);
  }
  return map;
}

// ── アカウント行の upsert（env → mail_accounts）──────────────
/** 環境変数の全アカウントを mail_accounts に反映し、address→id を返す */
export async function ensureAccounts(configs: MailConfig[]): Promise<Map<string, number>> {
  const byAddr = new Map<string, number>();
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const { data: existing } = await supabaseAdmin
      .from("mail_accounts")
      .select("id")
      .eq("address", c.address)
      .eq("is_deleted", false)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("mail_accounts")
        .update({ display_name: c.label, auth_ref: c.key, is_shared: c.shared, sort_order: i })
        .eq("id", existing.id);
      byAddr.set(c.address, existing.id);
    } else {
      const { data: created } = await supabaseAdmin
        .from("mail_accounts")
        .insert({
          address: c.address,
          display_name: c.label,
          provider: "imap",
          auth_ref: c.key,
          is_shared: c.shared,
          sort_order: i,
        })
        .select("id")
        .single();
      if (created) byAddr.set(c.address, created.id);
    }
  }
  return byAddr;
}

// ── 1アカウントの同期 ──────────────────────────────────────
export interface SyncResult {
  address: string;
  fetched: number;   // IMAPから取得した件数
  inserted: number;  // 新規にDBへ入れた件数
  ok: boolean;
  error?: string;
}

async function markAccount(accountId: number, patch: TablesUpdate<"mail_accounts">): Promise<void> {
  await supabaseAdmin.from("mail_accounts").update(patch).eq("id", accountId);
}

/** 1件の IMAP メッセージを DB 行（見出し・状態のみ）へ変換する。
 *  ハイブリッド型のため本文は保存しない。添付有無は bodyStructure から推定する。 */
function toRow(
  accountId: number,
  msg: FetchMessageObject,
  memberMap: Map<string, number>,
): TablesInsert<"mail_messages"> {
  const env = msg.envelope;
  const fromAddr = normEmail(env?.from?.[0]?.address ?? "");
  const fromName = (env?.from?.[0]?.name ?? "").trim();
  const toAddr = normEmail(env?.to?.[0]?.address ?? "");
  const subject = (env?.subject ?? "").trim();

  const flags = msg.flags ?? new Set<string>();
  const receivedAt = env?.date ?? msg.internalDate ?? null;

  return {
    account_id: accountId,
    uid: Number(msg.uid),
    message_id: (env?.messageId ?? "").trim(),
    thread_key: threadKeyOf(subject),
    from_name: fromName,
    from_addr: fromAddr,
    to_addr: toAddr,
    subject,
    member_id: memberMap.get(fromAddr) ?? null,
    is_read: flags.has("\\Seen"),
    is_starred: flags.has("\\Flagged"),
    is_flagged: false,
    has_attach: hasAttachmentStructure(msg.bodyStructure),
    received_at: receivedAt ? new Date(receivedAt).toISOString() : null,
  };
}

/**
 * 1アカウントを同期する。
 *   ・UIDVALIDITY が変わっていたらカーソルをリセット（全再取得）
 *   ・前回以降の UID だけ取り込む（初回は最新 MAIL_SYNC_MAX 件まで）
 *   ・既存行は上書きしない（ユーザーが付けた既読/スター/フラグを守る）
 */
export async function syncAccount(accountId: number, cfg: MailConfig): Promise<SyncResult> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  let fetched = 0;
  let inserted = 0;
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX");
    const uidValidity = Number(box.uidValidity);

    // 同期カーソルを読む（UIDVALIDITY が変わっていたら 0 に戻す）
    const { data: state } = await supabaseAdmin
      .from("mail_sync_state")
      .select("uid_validity, last_seen_uid")
      .eq("account_id", accountId)
      .maybeSingle();
    let lastSeen = state?.last_seen_uid ?? 0;
    if (state && Number(state.uid_validity) !== uidValidity) lastSeen = 0;

    // 取得範囲を決める
    const exists = Number(box.exists ?? 0);
    let range: string;
    let byUid: boolean;
    if (lastSeen > 0) {
      range = `${lastSeen + 1}:*`;
      byUid = true;
    } else {
      // 初回：最新 MAIL_SYNC_MAX 件だけを「連番（sequence）」で取る
      const start = Math.max(1, exists - syncMax() + 1);
      range = `${start}:*`;
      byUid = false;
    }

    const memberMap = await loadMemberEmailMap();
    const rows: TablesInsert<"mail_messages">[] = [];
    let maxUid = lastSeen;

    if (exists > 0) {
      // 本文(source)は取得しない。見出し＋フラグ＋添付判定(bodyStructure)だけを取る（軽量・高速）。
      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true },
        { uid: byUid },
      )) {
        fetched++;
        const uid = Number(msg.uid);
        if (byUid && uid <= lastSeen) continue; // 念のため
        rows.push(toRow(accountId, msg, memberMap));
        if (uid > maxUid) maxUid = uid;
      }
    }

    if (rows.length > 0) {
      // 既存（account_id, uid）は無視 ＝ ユーザーの既読/スター/フラグを保持
      const { data: up } = await supabaseAdmin
        .from("mail_messages")
        .upsert(rows, { onConflict: "account_id,uid", ignoreDuplicates: true })
        .select("id");
      inserted = up?.length ?? 0;
    }

    // 同期カーソルを保存
    await supabaseAdmin.from("mail_sync_state").upsert(
      { account_id: accountId, uid_validity: uidValidity, last_seen_uid: maxUid, updated_at: new Date().toISOString() },
      { onConflict: "account_id" },
    );
    await markAccount(accountId, {
      status: "connected",
      status_detail: "",
      last_synced_at: new Date().toISOString(),
    });

    return { address: cfg.address, fetched, inserted, ok: true };
  } catch (e: unknown) {
    const msg = errMessage(e, "IMAP同期に失敗しました");
    await markAccount(accountId, { status: "error", status_detail: msg }).catch(() => {});
    return { address: cfg.address, fetched, inserted, ok: false, error: msg };
  } finally {
    try {
      await client.logout();
    } catch {
      /* 既に切断済みでもよい */
    }
  }
}

// ── 資格情報の解決（DB暗号化 → env の順で解決）──────────────
interface AccountRow {
  id: number; address: string; display_name: string; auth_ref: string;
  is_shared: boolean; imap_host: string; imap_port: number; imap_user: string;
}

/** 1アカウントの接続設定を解決する。DBの暗号化資格情報を優先し、無ければ env にフォールバック。 */
async function resolveAccountConfig(a: AccountRow): Promise<MailConfig | null> {
  // (1) DB に保存された暗号化パスワード
  if (a.imap_host) {
    const { data } = await supabaseAdmin
      .from("mail_account_secrets")
      .select("secret_cipher")
      .eq("account_id", a.id)
      .maybeSingle();
    if (data?.secret_cipher) {
      try {
        return {
          key: "", address: a.address, label: a.display_name,
          host: a.imap_host, port: a.imap_port || 993,
          user: a.imap_user || a.address, pass: decryptSecret(data.secret_cipher),
          shared: a.is_shared,
        };
      } catch {
        return null; // 復号失敗（鍵変更など）→ 未設定扱い
      }
    }
  }
  // (2) 環境変数（auth_ref を接頭辞に）
  if (a.auth_ref) {
    const env = readEnvConfig(a.auth_ref);
    if (env) return env;
  }
  return null;
}

// ── 本文のオンデマンド取得（ハイブリッド型）────────────────
export interface MailBody { bodyText: string; bodyHtml: string; hasAttach: boolean; }

/** 指定メールの本文を IMAP から都度取得する（DBには保存しない）。
 *  ハイブリッド型の中核：一覧・見出しはDB、本文だけ開いた瞬間にサーバーから引く。 */
export async function fetchMessageBody(messageId: number): Promise<MailBody> {
  // 対象メールの account_id と uid を取り出す
  const { data: row } = await supabaseAdmin
    .from("mail_messages")
    .select("account_id, uid")
    .eq("id", messageId)
    .maybeSingle();
  if (!row) throw new Error("メールが見つかりません");

  // 所属アカウントの接続設定を解決
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", row.account_id)
    .maybeSingle();
  if (!acc) throw new Error("アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new Error("資格情報が未設定です");

  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
  });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const msg = await client.fetchOne(String(row.uid), { source: true }, { uid: true });
    if (!msg || !msg.source) throw new Error("本文を取得できませんでした（元メールが削除された可能性）");

    const parsed = await simpleParser(msg.source);
    const bodyText = parsed.text ?? "";
    const bodyHtml = typeof parsed.html === "string" ? parsed.html : "";
    const hasAttach = (parsed.attachments?.length ?? 0) > 0;

    // 添付有無は取得できた実値でDBを更新（best-effort）
    await supabaseAdmin.from("mail_messages").update({ has_attach: hasAttach }).eq("id", messageId).then(() => {}, () => {});
    return { bodyText, bodyHtml, hasAttach };
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

/** 全アカウントを同期する（API手動 / cron 共通の入口）。env と DB 登録の両方を対象にする。 */
export async function syncAllMail(): Promise<SyncResult[]> {
  // env 方式のアカウントを mail_accounts に反映（後方互換）
  const envConfigs = resolveMailConfigs();
  if (envConfigs.length > 0) await ensureAccounts(envConfigs);

  // DB 上の全アカウントを対象に同期
  const { data: accounts } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("is_deleted", false)
    .eq("provider", "imap")
    .order("sort_order", { ascending: true });

  const results: SyncResult[] = [];
  for (const a of (accounts as AccountRow[]) ?? []) {
    const cfg = await resolveAccountConfig(a);
    if (!cfg) {
      await markAccount(a.id, { status: "error", status_detail: "資格情報が未設定です" }).catch(() => {});
      results.push({ address: a.address, fetched: 0, inserted: 0, ok: false, error: "資格情報未設定" });
      continue;
    }
    results.push(await syncAccount(a.id, cfg));
  }
  return results;
}

// ── アプリ内アカウント管理（保存・削除・接続テスト）──────────
export interface MailAccountSaveInput {
  id?: number;
  address: string;
  label?: string;
  host: string;
  port?: number;
  user?: string;
  password?: string;   // 新規は必須。編集で空なら既存パスワードを維持
  shared?: boolean;
}

/** アカウントの作成／更新。パスワードは暗号化して mail_account_secrets に隔離保存。 */
export async function saveMailAccount(input: MailAccountSaveInput): Promise<{ id: number }> {
  const address = (input.address ?? "").trim();
  if (!address.includes("@")) throw new Error("メールアドレスが不正です");
  const host = (input.host ?? "").trim();
  if (!host) throw new Error("IMAPホストは必須です");
  const port = Number(input.port) || 993;
  const user = ((input.user ?? "").trim()) || address;
  const label = ((input.label ?? "").trim()) || address;
  const shared = input.shared !== false;
  const password = input.password ?? "";

  // 新規はパスワード必須（登録してから資格情報が無い状態を作らない）
  if (input.id == null && !password) throw new Error("パスワードは必須です");

  let id = input.id ?? null;
  if (id != null) {
    const { error } = await supabaseAdmin
      .from("mail_accounts")
      .update({ address, display_name: label, imap_host: host, imap_port: port, imap_user: user, is_shared: shared })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabaseAdmin
      .from("mail_accounts")
      .insert({ address, display_name: label, provider: "imap", auth_ref: "", imap_host: host, imap_port: port, imap_user: user, is_shared: shared })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "アカウント作成に失敗しました");
    id = data.id;
  }

  if (password) {
    const cipher = encryptSecret(password);
    const { error } = await supabaseAdmin
      .from("mail_account_secrets")
      .upsert({ account_id: id, secret_cipher: cipher, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
    if (error) throw new Error(error.message);
  }
  return { id: id! };
}

/** アカウントの論理削除（暗号化パスワードは物理削除する）。 */
export async function deleteMailAccount(id: number): Promise<void> {
  await supabaseAdmin.from("mail_account_secrets").delete().eq("account_id", id);
  const { error } = await supabaseAdmin.from("mail_accounts").update({ is_deleted: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** 接続テスト（保存せずに IMAP へつないで INBOX を開くだけ）。 */
export async function testMailAccount(input: MailAccountSaveInput): Promise<{ ok: boolean; error?: string }> {
  const host = (input.host ?? "").trim();
  const port = Number(input.port) || 993;
  const user = ((input.user ?? "").trim()) || (input.address ?? "").trim();
  let pass = input.password ?? "";
  // 編集時にパスワード未入力なら保存済みの暗号文を使う
  if (!pass && input.id != null) {
    const { data } = await supabaseAdmin
      .from("mail_account_secrets").select("secret_cipher").eq("account_id", input.id).maybeSingle();
    if (data?.secret_cipher) {
      try { pass = decryptSecret(data.secret_cipher); } catch { /* 復号失敗はそのまま下で弾く */ }
    }
  }
  if (!host || !pass) return { ok: false, error: "ホストとパスワードが必要です" };

  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMessage(e, "接続に失敗しました") };
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}
