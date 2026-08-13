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
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { supabaseAdmin } from "./supabaseAdmin";
import { errMessage } from "./errors";
import { HttpError } from "./authz";
import { encryptSecret, decryptSecret, isSecretKeyConfigured } from "./mailCrypto";
import type { TablesInsert, TablesUpdate, Json } from "./database.types";

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
 *  ハイブリッド型のため本文は保存しない。添付有無は bodyStructure から推定する。
 *  会員照合は「受信は差出人、送信は宛先」で行う（送信メールは相手＝宛先が会員）。 */
function toRow(
  accountId: number,
  folder: string,
  direction: "in" | "out",
  msg: FetchMessageObject,
  memberMap: Map<string, number>,
): TablesInsert<"mail_messages"> {
  const env = msg.envelope;
  const fromAddr = normEmail(env?.from?.[0]?.address ?? "");
  const fromName = (env?.from?.[0]?.name ?? "").trim();
  const toAddr = normEmail(env?.to?.[0]?.address ?? "");
  const subject = (env?.subject ?? "").trim();
  // 会話の相手：受信＝差出人、送信＝宛先
  const counterpart = direction === "out" ? toAddr : fromAddr;

  const flags = msg.flags ?? new Set<string>();
  const receivedAt = env?.date ?? msg.internalDate ?? null;

  return {
    account_id: accountId,
    uid: Number(msg.uid),
    folder,
    direction,
    message_id: (env?.messageId ?? "").trim(),
    thread_key: threadKeyOf(subject),
    in_reply_to: (env?.inReplyTo ?? "").trim(),
    counterpart,
    from_name: fromName,
    from_addr: fromAddr,
    to_addr: toAddr,
    subject,
    member_id: memberMap.get(counterpart) ?? null,
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
  const client = newClient(cfg);

  let fetched = 0;
  let inserted = 0;
  try {
    await client.connect();
    const memberMap = await loadMemberEmailMap();
    // 同期対象フォルダを列挙（受信箱・送信済み・ゴミ箱・カスタム等）
    const folders = await listSyncFolders(client);
    for (const f of folders) {
      try {
        const r = await syncFolder(client, accountId, f.path, f.direction, memberMap);
        fetched += r.fetched;
        inserted += r.inserted;
      } catch {
        // 1フォルダの失敗で全体を止めない（次のフォルダへ）
      }
    }
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

// ── 同期対象フォルダの列挙 ──────────────────────────────────
export interface SyncFolder { path: string; name: string; specialUse: string; direction: "in" | "out"; }

/** IMAP の全フォルダを列挙し、同期対象（選択可能なもの）を返す。
 *  SPECIAL-USE で用途を判定し、送信/下書きは direction=out にする。 */
async function listSyncFolders(client: ImapFlow): Promise<SyncFolder[]> {
  const list = await client.list();
  const out: SyncFolder[] = [];
  for (const box of list) {
    // 選択できないフォルダ（親ノード等）は対象外
    const flags = (box.flags ?? new Set<string>()) as Set<string>;
    if (flags.has("\\Noselect")) continue;
    const su = (box.specialUse ?? "") as string;
    const direction: "in" | "out" = su === "\\Sent" || su === "\\Drafts" ? "out" : "in";
    out.push({ path: box.path, name: box.name ?? box.path, specialUse: su, direction });
  }
  return out;
}

/** 1フォルダを同期する（前回以降のUIDだけ・見出しのみ）。 */
async function syncFolder(
  client: ImapFlow,
  accountId: number,
  folder: string,
  direction: "in" | "out",
  memberMap: Map<string, number>,
): Promise<{ fetched: number; inserted: number }> {
  const box = await client.mailboxOpen(folder);
  const uidValidity = Number(box.uidValidity);

  const { data: state } = await supabaseAdmin
    .from("mail_sync_state")
    .select("uid_validity, last_seen_uid")
    .eq("account_id", accountId)
    .eq("folder", folder)
    .maybeSingle();
  let lastSeen = state?.last_seen_uid ?? 0;
  if (state && Number(state.uid_validity) !== uidValidity) lastSeen = 0;

  const exists = Number(box.exists ?? 0);
  let range: string;
  let byUid: boolean;
  if (lastSeen > 0) {
    range = `${lastSeen + 1}:*`;
    byUid = true;
  } else {
    const start = Math.max(1, exists - syncMax() + 1);
    range = `${start}:*`;
    byUid = false;
  }

  const rows: TablesInsert<"mail_messages">[] = [];
  let maxUid = lastSeen;
  let fetched = 0;

  if (exists > 0) {
    for await (const msg of client.fetch(
      range,
      { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true },
      { uid: byUid },
    )) {
      fetched++;
      const uid = Number(msg.uid);
      if (byUid && uid <= lastSeen) continue;
      rows.push(toRow(accountId, folder, direction, msg, memberMap));
      if (uid > maxUid) maxUid = uid;
    }
  }

  let inserted = 0;
  if (rows.length > 0) {
    // 既存（account_id, folder, uid）は無視 ＝ ユーザーの既読/スター/フラグを保持
    const { data: up } = await supabaseAdmin
      .from("mail_messages")
      .upsert(rows, { onConflict: "account_id,folder,uid", ignoreDuplicates: true })
      .select("id");
    inserted = up?.length ?? 0;
  }

  await supabaseAdmin.from("mail_sync_state").upsert(
    { account_id: accountId, folder, uid_validity: uidValidity, last_seen_uid: maxUid, updated_at: new Date().toISOString() },
    { onConflict: "account_id,folder" },
  );
  return { fetched, inserted };
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

// 本文の短時間メモリキャッシュ（DBには保存しない・プロセスが生きている間だけ）。
//   同じメールの再オープンや先読み→クリックを高速化する。TTL経過で破棄。
const BODY_CACHE = new Map<number, { body: MailBody; exp: number }>();
const BODY_TTL_MS = 3 * 60 * 1000;   // 3分
const BODY_CACHE_MAX = 200;

function bodyCacheGet(id: number): MailBody | null {
  const hit = BODY_CACHE.get(id);
  if (!hit) return null;
  if (Date.now() > hit.exp) { BODY_CACHE.delete(id); return null; }
  return hit.body;
}
function bodyCacheSet(id: number, body: MailBody): void {
  if (BODY_CACHE.size >= BODY_CACHE_MAX) {
    const oldest = BODY_CACHE.keys().next().value;
    if (oldest !== undefined) BODY_CACHE.delete(oldest);
  }
  BODY_CACHE.set(id, { body, exp: Date.now() + BODY_TTL_MS });
}

// ── 本文のDB保存は暗号化する（情報漏洩対策・保存時暗号化）──────
//   接頭辞 "enc:v1:" 付きは暗号文。付いていなければ旧データ（平文）として扱う。
//   鍵未設定時は平文で保存（機能は維持。鍵設定後の書き込みから暗号化される）。
const ENC_PREFIX = "enc:v1:";
function encBody(plain: string): string {
  if (!plain) return "";
  if (!isSecretKeyConfigured()) return plain;
  try { return ENC_PREFIX + encryptSecret(plain); } catch { return plain; }
}
function decBody(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored;   // 旧平文はそのまま
  try { return decryptSecret(stored.slice(ENC_PREFIX.length)); } catch { return ""; }
}

/** 指定メールの本文を IMAP から都度取得する（DBには保存しない）。
 *  ハイブリッド型の中核：一覧・見出しはDB、本文だけ開いた瞬間にサーバーから引く。 */
export async function fetchMessageBody(messageId: number, force = false): Promise<MailBody> {
  // force のときはキャッシュ（メモリ／DB）を無視して IMAP から取り直す（再取得コマンド）
  // 直近に取得済みならメモリキャッシュを返す（IMAP接続を省いて高速化）
  if (!force) {
    const cached = bodyCacheGet(messageId);
    if (cached) return cached;
  }

  // 対象メールの account_id / uid / folder ＋ 本文キャッシュを取り出す
  const { data: row } = await supabaseAdmin
    .from("mail_messages")
    .select("account_id, uid, folder, has_attach, body_text, body_html, body_cached_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!row) throw new HttpError(404, "メールが見つかりません");

  // DBに本文キャッシュがあればIMAPへ行かずに返す（①対策：サーバーから消えても表示可）
  if (!force && row.body_cached_at) {
    const fromDb: MailBody = {
      bodyText: decBody(row.body_text),
      bodyHtml: decBody(row.body_html),
      hasAttach: !!row.has_attach,
    };
    bodyCacheSet(messageId, fromDb);
    return fromDb;
  }

  // 所属アカウントの接続設定を解決
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", row.account_id)
    .maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");

  const client = newClient(cfg);
  const t0 = Date.now();
  try {
    await client.connect();
    await client.mailboxOpen(row.folder || "INBOX");
    const tConn = Date.now() - t0;

    // まず先頭 1MB だけ取得して解析する（巨大な添付をまるごとDLしないための高速化）。
    // 本文（text/html）は通常メール先頭に来るため、これで大半は本文を取得できる。
    const CAP = 1024 * 1024;
    let bodyText = "";
    let bodyHtml = "";
    let hasAttach = false;
    try {
      const capped = await client.fetchOne(String(row.uid), { source: { maxLength: CAP }, bodyStructure: true }, { uid: true });
      if (capped) {
        hasAttach = hasAttachmentStructure(capped.bodyStructure);
        if (capped.source) {
          const p = await simpleParser(capped.source);
          bodyText = p.text ?? "";
          bodyHtml = typeof p.html === "string" ? p.html : "";
        }
      }
    } catch { /* 部分取得に非対応なサーバー等 → 下の全文取得へ */ }

    // 本文が取れなければ全文で取り直す（本文が添付の後ろにある等のレアケース）
    if (!bodyText.trim() && !bodyHtml) {
      const full = await client.fetchOne(String(row.uid), { source: true }, { uid: true });
      if (!full || !full.source) throw new HttpError(404, "本文を取得できませんでした（元メールが削除された可能性）");
      const p = await simpleParser(full.source);
      bodyText = p.text ?? "";
      bodyHtml = typeof p.html === "string" ? p.html : "";
      hasAttach = hasAttach || (p.attachments?.length ?? 0) > 0;
    }

    console.info(`[mail/body] id=${messageId} connect=${tConn}ms total=${Date.now() - t0}ms`);
    // 本文と添付有無を DB に遅延キャッシュ（best-effort）。以後の再オープンはDBから即返す。
    await supabaseAdmin
      .from("mail_messages")
      .update({ body_text: encBody(bodyText), body_html: encBody(bodyHtml), has_attach: hasAttach, body_cached_at: new Date().toISOString() })
      .eq("id", messageId)
      .then(() => {}, () => {});
    const result = { bodyText, bodyHtml, hasAttach };
    bodyCacheSet(messageId, result);   // 短時間メモリキャッシュ
    return result;
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

// ── 添付ファイル（一覧・ダウンロード）────────────────────────
export interface AttachmentMeta { index: number; filename: string; contentType: string; size: number }
export interface AttachmentFile extends AttachmentMeta { contentBase64: string }

/** メールの添付を取得する。index 未指定なら一覧、指定ならその1件（base64付き）を返す。
 *  本文と同じく IMAP から全文取得して mailparser で解析する。 */
export async function fetchMessageAttachments(messageId: number, index?: number): Promise<AttachmentMeta[] | AttachmentFile> {
  const { data: row } = await supabaseAdmin
    .from("mail_messages").select("account_id, uid, folder").eq("id", messageId).maybeSingle();
  if (!row) throw new HttpError(404, "メールが見つかりません");
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", row.account_id).maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");

  const client = newClient(cfg);
  try {
    await client.connect();
    await client.mailboxOpen(row.folder || "INBOX");
    const full = await client.fetchOne(String(row.uid), { source: true }, { uid: true });
    if (!full || !full.source) throw new HttpError(404, "メール本文を取得できませんでした（元メールが削除された可能性）");
    const parsed = await simpleParser(full.source);
    const atts = (parsed.attachments ?? []).map((a, i) => ({
      index: i,
      filename: a.filename || `attachment-${i + 1}`,
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? (a.content?.length ?? 0),
      content: a.content as Buffer,
    }));
    if (index == null) {
      return atts.map(({ index: idx, filename, contentType, size }) => ({ index: idx, filename, contentType, size }));
    }
    const t = atts[index];
    if (!t) throw new HttpError(404, "指定の添付が見つかりません");
    return { index: t.index, filename: t.filename, contentType: t.contentType, size: t.size, contentBase64: t.content.toString("base64") };
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

// ── フォルダ一覧（表示用）────────────────────────────────────
export interface FolderInfo {
  path: string; name: string; specialUse: string; direction: "in" | "out"; unread: number; total: number;
}

/** 指定アカウントのフォルダ一覧を IMAP から取得し、DB上の未読/総数を添えて返す。 */
export async function listAccountFolders(accountId: number): Promise<FolderInfo[]> {
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");

  const client = newClient(cfg);
  let folders: SyncFolder[] = [];
  try {
    await client.connect();
    folders = await listSyncFolders(client);
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }

  // DB 上の未読/総数（フォルダ別）を数える
  const out: FolderInfo[] = [];
  for (const f of folders) {
    const base = () =>
      supabaseAdmin.from("mail_messages").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("folder", f.path);
    const [total, unread] = await Promise.all([base(), base().eq("is_read", false)]);
    out.push({
      path: f.path, name: f.name, specialUse: f.specialUse, direction: f.direction,
      unread: unread.count ?? 0, total: total.count ?? 0,
    });
  }
  return out;
}

// ── アカウント接続ヘルパー ──────────────────────────────────
/** accountId から接続設定を解決する（無ければ例外）。 */
async function getAccountCfg(accountId: number): Promise<MailConfig> {
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");
  return cfg;
}

/** ImapFlow を生成する唯一の入口。タイムアウトを必ず入れて「無限ハング」を防ぐ。
 *   接続や応答が詰まったら数十秒で失敗させ、画面に即エラーを返す（5分待ちを防ぐ）。 */
function imapClient(host: string, port: number, user: string, pass: string): ImapFlow {
  return new ImapFlow({
    host, port, secure: port === 993,
    auth: { user, pass }, logger: false,
    greetingTimeout: 15000,     // 接続後の挨拶待ち 15秒
    connectionTimeout: 15000,   // TCP/TLS接続 15秒
    socketTimeout: 90000,       // 無通信 90秒で切断
  });
}

/** 設定から未接続の ImapFlow を作る（呼び出し側で connect / logout する）。 */
function newClient(cfg: MailConfig): ImapFlow {
  return imapClient(cfg.host, cfg.port, cfg.user, cfg.pass);
}

// ── メールの移動（フォルダ間・IMAP MOVE）────────────────────
/** メールを別フォルダへ移動する。IMAPへMOVEし、DBの folder/uid も更新（不明時は行削除して次回同期に委ねる）。 */
export async function moveMessage(messageId: number, targetFolder: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("mail_messages").select("account_id, uid, folder").eq("id", messageId).maybeSingle();
  if (!row) throw new HttpError(404, "メールが見つかりません");
  if (row.folder === targetFolder) return;

  const client = newClient(await getAccountCfg(row.account_id));
  try {
    await client.connect();
    await client.mailboxOpen(row.folder || "INBOX");
    const res = await client.messageMove(String(row.uid), targetFolder, { uid: true });
    // 移動先の新UIDが取れれば行を更新、取れなければ削除（次回同期で移動先に現れる）
    const uidMap = (res as { uidMap?: Map<number, number> } | undefined)?.uidMap;
    const newUid = uidMap ? uidMap.get(Number(row.uid)) : undefined;
    if (newUid) {
      await supabaseAdmin.from("mail_messages").update({ folder: targetFolder, uid: Number(newUid) }).eq("id", messageId);
    } else {
      await supabaseAdmin.from("mail_messages").delete().eq("id", messageId);
    }
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

// ── 既読/スターの IMAP 反映（双方向連携）────────────────────
/** 既読(\Seen)・スター(\Flagged)を IMAP に反映する。DB は呼び出し側（クライアント）が更新済みの前提。
 *  best-effort：失敗しても DB を正とする（例外は投げない）。 */
export async function pushMailFlagToImap(messageId: number, patch: { isRead?: boolean; isStarred?: boolean }): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("mail_messages").select("account_id, uid, folder").eq("id", messageId).maybeSingle();
  if (!row) return;
  const add: string[] = [];
  const del: string[] = [];
  if (patch.isRead === true) add.push("\\Seen");
  if (patch.isRead === false) del.push("\\Seen");
  if (patch.isStarred === true) add.push("\\Flagged");
  if (patch.isStarred === false) del.push("\\Flagged");
  if (add.length === 0 && del.length === 0) return;

  const client = newClient(await getAccountCfg(row.account_id));
  try {
    await client.connect();
    await client.mailboxOpen(row.folder || "INBOX");
    if (add.length) await client.messageFlagsAdd(String(row.uid), add, { uid: true });
    if (del.length) await client.messageFlagsRemove(String(row.uid), del, { uid: true });
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

// ── フォルダの作成／改名／削除（IMAP側に反映）────────────────
export async function createFolder(accountId: number, path: string): Promise<void> {
  const client = newClient(await getAccountCfg(accountId));
  try { await client.connect(); await client.mailboxCreate(path); }
  finally { try { await client.logout(); } catch { /* noop */ } }
}

export async function renameFolder(accountId: number, path: string, newPath: string): Promise<void> {
  const client = newClient(await getAccountCfg(accountId));
  try { await client.connect(); await client.mailboxRename(path, newPath); }
  finally { try { await client.logout(); } catch { /* noop */ } }
  // DB側のフォルダ名も付け替える
  await supabaseAdmin.from("mail_messages").update({ folder: newPath }).eq("account_id", accountId).eq("folder", path);
  await supabaseAdmin.from("mail_sync_state").update({ folder: newPath }).eq("account_id", accountId).eq("folder", path);
}

export async function deleteFolder(accountId: number, path: string): Promise<void> {
  if (path === "INBOX") throw new Error("受信トレイは削除できません");
  const client = newClient(await getAccountCfg(accountId));
  try { await client.connect(); await client.mailboxDelete(path); }
  finally { try { await client.logout(); } catch { /* noop */ } }
  // DB側の当該フォルダのメール・同期カーソルも掃除する
  await supabaseAdmin.from("mail_messages").delete().eq("account_id", accountId).eq("folder", path);
  await supabaseAdmin.from("mail_sync_state").delete().eq("account_id", accountId).eq("folder", path);
}

// ── 送信（SMTP）＋ Sent 追記（Step 4）──────────────────────
/** 添付ファイル（本文と一緒に base64 で受け渡す）。 */
export interface MailAttachment {
  filename: string;
  contentBase64: string;   // ファイル内容（base64。data URL 接頭辞は含めない）
  contentType?: string;
}

export interface SendMailInput {
  accountId: number;
  to: string;
  cc?: string;          // カンマ/セミコロン/空白区切り
  bcc?: string;
  subject: string;
  text: string;
  html?: string;        // HTML本文（一斉配信の計測リンク付き本文など）。無ければ text のみ。
  replyToId?: number;   // 返信元メール（あればスレッドヘッダと宛先/件名を補完）
  sentBy?: number | null;   // 送信スタッフ（members.id）。対応ログ抽出のため mail_send_log に残す
  attachments?: MailAttachment[];   // 添付ファイル
  /** 一斉配信など大量送信で Sent への追記をスキップ（IMAP APPEND を毎通行うと重いため） */
  skipSent?: boolean;
  /** 配信停止URL。指定すると List-Unsubscribe ヘッダを付与する（一斉配信・シナリオ用）。 */
  listUnsubscribe?: string;
}

/** 下書き保存の入力。宛先が空でも保存できる（送信と違い必須ではない）。 */
export interface SaveDraftInput {
  accountId: number;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text: string;
  attachments?: MailAttachment[];
  replyToId?: number;         // 返信元（スレッドヘッダ補完用）
  replaceMessageId?: number;  // 既存下書きを編集保存する場合、旧下書きを削除する
  sentBy?: number | null;
}

/** "a@x.com, b@y.com; c@z.com" → ["a@x.com","b@y.com","c@z.com"]（重複・空を除去） */
function splitAddrs(s?: string): string[] {
  if (!s) return [];
  const seen = new Set<string>();
  return s.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => {
    if (!x || seen.has(x.toLowerCase())) return false;
    seen.add(x.toLowerCase()); return true;
  });
}

interface MailAccountFull extends AccountRow { smtp_host: string; smtp_port: number }

/** MailAttachment[] を MailComposer 用の添付配列へ変換。 */
function toComposerAttachments(atts?: MailAttachment[]): { filename: string; content: Buffer; contentType?: string }[] | undefined {
  if (!atts || atts.length === 0) return undefined;
  return atts.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, "base64"),
    contentType: a.contentType || undefined,
  }));
}

/** 生MIMEを組み立てる（送信・Sent追記・下書きで共用）。 */
async function buildRawMime(opts: {
  fromName: string; fromAddr: string; to: string; cc?: string; bcc?: string; subject: string;
  text: string; html?: string; inReplyTo?: string; attachments?: MailAttachment[];
  listUnsubscribe?: string;
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: opts.fromName || opts.fromAddr, address: opts.fromAddr },
    to: opts.to, subject: opts.subject, text: opts.text,
    cc: (opts.cc ?? "").trim() ? opts.cc : undefined,
    bcc: (opts.bcc ?? "").trim() ? opts.bcc : undefined,
    html: (opts.html ?? "").trim() ? opts.html : undefined,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.inReplyTo || undefined,
    attachments: toComposerAttachments(opts.attachments),
    ...(opts.listUnsubscribe ? { list: { unsubscribe: { url: opts.listUnsubscribe, comment: "配信停止" } } } : {}),
  });
  return await new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

/** 送信した生メールを Sent フォルダへ追記し、会話に即反映するDB行を作る。 */
async function appendToSent(acc: MailAccountFull, cfg: MailConfig, raw: Buffer, to: string, subject: string, hasAttach = false): Promise<void> {
  const client = newClient(cfg);
  try {
    await client.connect();
    const list = await client.list();
    const sent =
      list.find((b) => (b.specialUse ?? "") === "\\Sent") ??
      list.find((b) => /sent|送信/i.test(b.path));
    if (!sent) return; // Sent が無ければ追記はスキップ（送信自体は成功済み）
    const res = await client.append(sent.path, raw, ["\\Seen"]);
    const uid = (res as { uid?: number } | undefined)?.uid;
    if (uid) {
      await supabaseAdmin.from("mail_messages").upsert({
        account_id: acc.id, uid: Number(uid), folder: sent.path, direction: "out",
        message_id: "", thread_key: threadKeyOf(subject), in_reply_to: "",
        counterpart: normEmail(to), from_name: acc.display_name || acc.address,
        from_addr: normEmail(acc.address), to_addr: normEmail(to), subject,
        member_id: null, is_read: true, is_starred: false, is_flagged: false,
        has_attach: hasAttach, received_at: new Date().toISOString(),
      }, { onConflict: "account_id,folder,uid", ignoreDuplicates: true });
    }
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

/** アカウントの SMTP で送信する。返信なら In-Reply-To/References と件名/宛先を補完し、Sent にも残す。 */
export async function sendMailFromAccount(input: SendMailInput): Promise<void> {
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user, smtp_host, smtp_port")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  if (!acc.smtp_host) throw new HttpError(400, "SMTPホストが未設定です（アカウント編集で設定してください）");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");

  let subject = (input.subject ?? "").trim();
  let to = (input.to ?? "").trim();
  let inReplyTo = "";
  // 返信元があればスレッド情報・宛先・件名を補完
  if (input.replyToId != null) {
    const { data: orig } = await supabaseAdmin
      .from("mail_messages")
      .select("message_id, subject, counterpart, from_addr")
      .eq("id", input.replyToId).maybeSingle();
    if (orig) {
      inReplyTo = orig.message_id || "";
      if (!to) to = orig.counterpart || orig.from_addr || "";
      if (!subject) subject = /^\s*re:/i.test(orig.subject ?? "") ? (orig.subject ?? "") : `Re: ${orig.subject ?? ""}`;
    }
  }
  if (!to) throw new HttpError(400, "宛先が空です");

  const smtpPort = Number(acc.smtp_port) || 465;
  const transporter = nodemailer.createTransport({
    host: acc.smtp_host, port: smtpPort, secure: smtpPort === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  // 生MIMEを組み立て（Sentへ同じものを残すため。添付も含める）
  // Bcc は MIME ヘッダに載せない（Sent へ漏らさない）。実際の宛先は envelope で指定する。
  const ccList = splitAddrs(input.cc);
  const bccList = splitAddrs(input.bcc);
  const hasAttach = (input.attachments?.length ?? 0) > 0;
  const raw = await buildRawMime({
    fromName: acc.display_name || acc.address, fromAddr: acc.address,
    to, cc: ccList.join(", "), subject, text: input.text, html: input.html,
    inReplyTo, attachments: input.attachments,
    listUnsubscribe: input.listUnsubscribe,
  });

  // 実際の配送先（RCPT TO）は To + Cc + Bcc すべて
  const rcpt = Array.from(new Set([to, ...ccList, ...bccList].filter(Boolean)));
  await transporter.sendMail({ envelope: { from: acc.address, to: rcpt }, raw });
  // best-effort：Sent へ残す（失敗しても送信自体は成功）。一斉配信では skipSent で省略。
  if (!input.skipSent) {
    try { await appendToSent(acc as MailAccountFull, cfg, raw, to, subject, hasAttach); } catch { /* noop */ }
  }

  // best-effort：スタッフ別 対応ログ用の送信記録（direction=out の同期行は送信者を持たないため）
  try {
    // 宛先アドレスから会員を照合できれば member_id も残す（照合できなくてもログは残す）
    let memberId: number | null = null;
    if (to) {
      const { data: mem } = await supabaseAdmin
        .from("members").select("id").ilike("email", to).eq("is_deleted", false).limit(1);
      memberId = mem?.[0]?.id ?? null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("mail_send_log").insert({
      account_id: input.accountId,
      sent_by: input.sentBy ?? null,
      to_addr: to,
      subject,
      member_id: memberId,
    });
  } catch { /* noop */ }
}

/** メールを完全に削除する（IMAP \Deleted + expunge）。下書きの編集保存で旧下書きを消すのに使う。 */
export async function deleteMessage(messageId: number): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("mail_messages").select("account_id, uid, folder").eq("id", messageId).maybeSingle();
  if (!row) return;
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user")
    .eq("id", row.account_id).maybeSingle();
  if (!acc) return;
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) return;
  const client = newClient(cfg);
  try {
    await client.connect();
    await client.mailboxOpen(row.folder || "INBOX");
    await client.messageDelete(String(row.uid), { uid: true });
  } catch { /* IMAP側が消せなくてもDB行は消す（次回同期で整合） */ }
  finally { try { await client.logout(); } catch { /* noop */ } }
  await supabaseAdmin.from("mail_messages").delete().eq("id", messageId).then(() => {}, () => {});
}

/** 下書きを IMAP の Drafts フォルダへ保存する（\Draft フラグ付き APPEND）。
 *  宛先が空でも保存でき、DB行も作って一覧に即反映する。本文はDBキャッシュも入れる。 */
export async function saveDraftToAccount(input: SaveDraftInput): Promise<{ id: number | null }> {
  const { data: acc } = await supabaseAdmin
    .from("mail_accounts")
    .select("id, address, display_name, auth_ref, is_shared, imap_host, imap_port, imap_user, smtp_host, smtp_port")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!acc) throw new HttpError(404, "アカウントが見つかりません");
  const cfg = await resolveAccountConfig(acc as AccountRow);
  if (!cfg) throw new HttpError(400, "資格情報が未設定です");

  let subject = (input.subject ?? "").trim();
  let to = (input.to ?? "").trim();
  let inReplyTo = "";
  if (input.replyToId != null) {
    const { data: orig } = await supabaseAdmin
      .from("mail_messages").select("message_id, subject, counterpart, from_addr")
      .eq("id", input.replyToId).maybeSingle();
    if (orig) {
      inReplyTo = orig.message_id || "";
      if (!to) to = orig.counterpart || orig.from_addr || "";
      if (!subject) subject = /^\s*re:/i.test(orig.subject ?? "") ? (orig.subject ?? "") : `Re: ${orig.subject ?? ""}`;
    }
  }

  const hasAttach = (input.attachments?.length ?? 0) > 0;
  // 下書きは Cc/Bcc も MIME に保持しておく（あとで開いて送るときに復元できるよう）
  const raw = await buildRawMime({
    fromName: acc.display_name || acc.address, fromAddr: acc.address,
    to, cc: splitAddrs(input.cc).join(", "), bcc: splitAddrs(input.bcc).join(", "),
    subject, text: input.text, inReplyTo, attachments: input.attachments,
  });

  let newId: number | null = null;
  const client = newClient(cfg);
  try {
    await client.connect();
    const list = await client.list();
    const drafts =
      list.find((b) => (b.specialUse ?? "") === "\\Drafts") ??
      list.find((b) => /draft|下書き/i.test(b.path));
    if (!drafts) throw new HttpError(400, "Drafts（下書き）フォルダが見つかりません");
    const res = await client.append(drafts.path, raw, ["\\Draft", "\\Seen"]);
    const uid = (res as { uid?: number } | undefined)?.uid;
    if (uid) {
      const { data: up } = await supabaseAdmin.from("mail_messages").upsert({
        account_id: acc.id, uid: Number(uid), folder: drafts.path, direction: "out",
        message_id: "", thread_key: threadKeyOf(subject), in_reply_to: inReplyTo,
        counterpart: normEmail(to), from_name: acc.display_name || acc.address,
        from_addr: normEmail(acc.address), to_addr: normEmail(to), subject,
        member_id: null, is_read: true, is_starred: false, is_flagged: false,
        has_attach: hasAttach, received_at: new Date().toISOString(),
        body_text: encBody(input.text), body_html: "", body_cached_at: new Date().toISOString(),
      }, { onConflict: "account_id,folder,uid", ignoreDuplicates: true }).select("id").maybeSingle();
      newId = up?.id ?? null;
    }
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }

  // 編集保存なら旧下書きを削除（重複防止）
  if (input.replaceMessageId != null) {
    await deleteMessage(input.replaceMessageId).catch(() => {});
  }
  return { id: newId };
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
  smtpHost?: string;   // 送信用（空なら送信不可）
  smtpPort?: number;
  notes?: string;      // 特記事項（複数行メモ）
  signature?: string;  // 署名（メール作成時に本文末へ自動挿入）
}

/** アカウントの作成／更新。パスワードは暗号化して mail_account_secrets に隔離保存。 */
export async function saveMailAccount(input: MailAccountSaveInput): Promise<{ id: number }> {
  const address = (input.address ?? "").trim();
  if (!address.includes("@")) throw new HttpError(400, "メールアドレスが不正です");
  const host = (input.host ?? "").trim();
  if (!host) throw new HttpError(400, "IMAPホストは必須です");
  const port = Number(input.port) || 993;
  const user = ((input.user ?? "").trim()) || address;
  const label = ((input.label ?? "").trim()) || address;
  const shared = input.shared !== false;
  const password = input.password ?? "";
  const smtpHost = (input.smtpHost ?? "").trim();
  const smtpPort = Number(input.smtpPort) || 465;
  const notes = input.notes ?? "";
  const signature = input.signature ?? "";

  // 新規はパスワード必須（登録してから資格情報が無い状態を作らない）
  if (input.id == null && !password) throw new HttpError(400, "パスワードは必須です");

  let id = input.id ?? null;
  if (id != null) {
    const { error } = await supabaseAdmin
      .from("mail_accounts")
      .update({ address, display_name: label, imap_host: host, imap_port: port, imap_user: user, is_shared: shared, smtp_host: smtpHost, smtp_port: smtpPort, notes, signature })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabaseAdmin
      .from("mail_accounts")
      .insert({ address, display_name: label, provider: "imap", auth_ref: "", imap_host: host, imap_port: port, imap_user: user, is_shared: shared, smtp_host: smtpHost, smtp_port: smtpPort, notes, signature })
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

// ── 定型文テンプレート（サーバー経由CRUD）────────────────────
export interface MailTemplateRow { id: number; name: string; subject: string; body: string; sortOrder: number }
export interface MailTemplateInput { id?: number; name: string; subject?: string; body: string; sortOrder?: number }

export async function listMailTemplates(): Promise<MailTemplateRow[]> {
  const { data, error } = await supabaseAdmin
    .from("mail_templates")
    .select("id, name, subject, body, sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("listMailTemplates", error); return []; }
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, sortOrder: t.sort_order }));
}

export async function saveMailTemplate(input: MailTemplateInput): Promise<{ id: number }> {
  const name = (input.name ?? "").trim();
  if (!name) throw new HttpError(400, "テンプレート名は必須です");
  const row = { name, subject: input.subject ?? "", body: input.body ?? "", sort_order: input.sortOrder ?? 0, updated_at: new Date().toISOString() };
  if (input.id != null) {
    const { error } = await supabaseAdmin.from("mail_templates").update(row).eq("id", input.id);
    if (error) throw new Error(error.message);
    return { id: input.id };
  }
  const { data, error } = await supabaseAdmin.from("mail_templates").insert(row).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "テンプレートの保存に失敗しました");
  return { id: data.id };
}

export async function deleteMailTemplate(id: number): Promise<void> {
  const { error } = await supabaseAdmin.from("mail_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 送信予約（キュー＋cron）──────────────────────────────────
export interface ScheduleMailInput {
  accountId: number; to?: string; cc?: string; bcc?: string; subject?: string; text: string;
  replyToId?: number; attachments?: MailAttachment[]; scheduledAt: string; createdBy?: number | null;
}
export interface ScheduledMailRow {
  id: number; accountId: number; to: string; cc: string; bcc: string; subject: string;
  scheduledAt: string; status: string; error: string;
}

export async function createScheduledMail(input: ScheduleMailInput): Promise<{ id: number }> {
  const to = (input.to ?? "").trim();
  if (!to) throw new HttpError(400, "宛先が空です");
  if (!input.text.trim()) throw new HttpError(400, "本文が空です");
  const when = new Date(input.scheduledAt);
  if (isNaN(when.getTime())) throw new HttpError(400, "予約日時が不正です");
  if (when.getTime() < Date.now() - 60_000) throw new HttpError(400, "予約日時は現在より後にしてください");
  const { data, error } = await supabaseAdmin.from("mail_scheduled").insert({
    account_id: input.accountId, to_addr: to, cc: input.cc ?? "", bcc: input.bcc ?? "",
    subject: input.subject ?? "", body: input.text, reply_to_id: input.replyToId ?? null,
    attachments: (input.attachments ?? null) as unknown as Json, scheduled_at: when.toISOString(),
    status: "pending", created_by: input.createdBy ?? null,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "予約の作成に失敗しました");
  return { id: data.id };
}

export async function listScheduledMail(): Promise<ScheduledMailRow[]> {
  const { data, error } = await supabaseAdmin
    .from("mail_scheduled")
    .select("id, account_id, to_addr, cc, bcc, subject, scheduled_at, status, error")
    .eq("status", "pending")
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (error) { console.error("listScheduledMail", error); return []; }
  return (data ?? []).map((r) => ({
    id: r.id, accountId: r.account_id, to: r.to_addr, cc: r.cc, bcc: r.bcc,
    subject: r.subject, scheduledAt: r.scheduled_at, status: r.status, error: r.error,
  }));
}

export async function cancelScheduledMail(id: number): Promise<void> {
  const { error } = await supabaseAdmin.from("mail_scheduled")
    .update({ status: "canceled" }).eq("id", id).eq("status", "pending");
  if (error) throw new Error(error.message);
}

/** 予約分のうち到来したものを送信する（cron から呼ぶ）。 */
export async function runScheduledMail(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: due } = await supabaseAdmin
    .from("mail_scheduled")
    .select("id, account_id, to_addr, cc, bcc, subject, body, reply_to_id, attachments, created_by")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);
  const rows = due ?? [];
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      await sendMailFromAccount({
        accountId: r.account_id, to: r.to_addr, cc: r.cc, bcc: r.bcc,
        subject: r.subject, text: r.body, replyToId: r.reply_to_id ?? undefined,
        attachments: (r.attachments as unknown as MailAttachment[]) ?? undefined,
        sentBy: r.created_by ?? null,
      });
      await supabaseAdmin.from("mail_scheduled").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    } catch (e: unknown) {
      await supabaseAdmin.from("mail_scheduled").update({ status: "failed", error: errMessage(e) }).eq("id", r.id);
      failed++;
    }
  }
  return { processed: rows.length, sent, failed };
}

// ── データ保持（情報漏洩対策の自動パージ）────────────────────
/**
 * DBに溜まる機微データ（本文キャッシュ・完了した予約）を定期削除する（cron から呼ぶ）。
 *   ・古い本文キャッシュ（body_text/html）は消す。見出しは残し、必要時にIMAP再取得。
 *   ・送信済/取消/失敗の予約は本文・添付ごと削除する。
 *   保持日数は環境変数で調整可（既定：本文30日 / 予約14日）。
 */
export async function purgeMailData(): Promise<{ bodiesCleared: number; scheduledDeleted: number }> {
  const bodyDays = Number(process.env.MAIL_BODY_RETENTION_DAYS) || 30;
  const schedDays = Number(process.env.MAIL_SCHEDULED_RETENTION_DAYS) || 14;
  const bodyCut = new Date(Date.now() - bodyDays * 86_400_000).toISOString();
  const schedCut = new Date(Date.now() - schedDays * 86_400_000).toISOString();

  const { data: cleared } = await supabaseAdmin
    .from("mail_messages")
    .update({ body_text: null, body_html: null, body_cached_at: null })
    .lt("body_cached_at", bodyCut)
    .select("id");

  const { data: deleted } = await supabaseAdmin
    .from("mail_scheduled")
    .delete()
    .in("status", ["sent", "canceled", "failed"])
    .lt("created_at", schedCut)
    .select("id");

  return { bodiesCleared: cleared?.length ?? 0, scheduledDeleted: deleted?.length ?? 0 };
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

  const client = imapClient(host, port, user, pass);
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
