// ============================================================
// メール（Phase 1・受信）：クライアント側の読み取り／マーキング
//   ・アカウント一覧／メール一覧／本文取得／既読・スター・フラグ … RLS(運営)で直接 supabase
//   ・受信同期（IMAP接続）… サーバー（/api/mail/sync）でのみ実行
//   （lib/bookmarks.ts と同じ「読みはRLS直・特権処理はAPI」の分担）
// ============================================================
import { supabase } from "./supabase";
import { apiFetch, apiFire } from "./apiClient";
import type { TablesUpdate } from "./database.types";

// ── ドメイン型（camelCase）────────────────────────────────
export interface MailAccount {
  id: number;
  address: string;
  displayName: string;
  provider: string;
  isShared: boolean;
  status: string;        // connected / error / paused
  statusDetail: string;
  lastSyncedAt: string | null;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  notes: string;
  unread: number;
  flagged: number;
  total: number;
}

/** アカウント追加／編集フォームの入力（password は編集時 空＝維持）*/
export interface MailAccountInput {
  id?: number;
  address: string;
  label?: string;
  host: string;
  port?: number;
  user?: string;
  password?: string;
  shared?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  notes?: string;
}

/** 一覧行（見出しのみ・本文もプレビューも持たない）*/
export interface MailMessage {
  id: number;
  accountId: number;
  folder: string;
  direction: string;     // in=受信 / out=送信
  counterpart: string;   // 会話の相手（受信=from / 送信=to）
  fromName: string;
  fromAddr: string;
  subject: string;
  memberId: number | null;
  isMember: boolean;     // 会員照合できたか（登録メアドフィルタの判定）
  isRead: boolean;
  isStarred: boolean;
  isFlagged: boolean;
  hasAttach: boolean;
  receivedAt: string | null;
}

/** IMAP フォルダ（表示用）*/
export interface MailFolder {
  path: string;
  name: string;
  specialUse: string;    // \Sent \Drafts \Trash \Junk など
  direction: string;
  unread: number;
  total: number;
}

/** 詳細（見出し＋宛先）。本文はDBに無いため fetchBody() で別途取得する。 */
export interface MailMessageFull extends MailMessage {
  toAddr: string;
}

/** 本文（オンデマンドでIMAPから取得）*/
export interface MailBody {
  bodyText: string;
  bodyHtml: string;
  hasAttach: boolean;
}

export interface MailFilter {
  folder?: string;           // 表示するフォルダ（未指定なら INBOX）
  registeredOnly?: boolean;  // リスト登録されている会員のメアドのみ
  flagged?: boolean;
  starred?: boolean;
  unread?: boolean;
  q?: string;
  limit?: number;
}

const LIST_COLS =
  "id, account_id, folder, direction, counterpart, from_name, from_addr, subject, member_id, is_read, is_starred, is_flagged, has_attach, received_at";

interface ListRow {
  id: number; account_id: number; folder: string; direction: string; counterpart: string;
  from_name: string; from_addr: string;
  subject: string; member_id: number | null;
  is_read: boolean; is_starred: boolean; is_flagged: boolean;
  has_attach: boolean; received_at: string | null;
}

const toMessage = (r: ListRow): MailMessage => ({
  id: r.id,
  accountId: r.account_id,
  folder: r.folder,
  direction: r.direction,
  counterpart: r.counterpart,
  fromName: r.from_name,
  fromAddr: r.from_addr,
  subject: r.subject,
  memberId: r.member_id,
  isMember: r.member_id != null,
  isRead: r.is_read,
  isStarred: r.is_starred,
  isFlagged: r.is_flagged,
  hasAttach: r.has_attach,
  receivedAt: r.received_at,
});

// ── アカウント一覧（件数つき）──────────────────────────────
export async function fetchAccounts(): Promise<MailAccount[]> {
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("id, address, display_name, provider, is_shared, status, status_detail, last_synced_at, sort_order, imap_host, imap_port, imap_user, smtp_host, smtp_port, notes")
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true });
  if (error) { console.error("fetchAccounts", error); return []; }

  const rows = data ?? [];
  // 件数はアカウントごとに head カウントで取る（本文を運ばない）
  const counts = await Promise.all(
    rows.map(async (a) => {
      const base = () =>
        supabase.from("mail_messages").select("id", { count: "exact", head: true }).eq("account_id", a.id);
      const [total, unread, flagged] = await Promise.all([
        base(),
        base().eq("is_read", false),
        base().eq("is_flagged", true),
      ]);
      return { total: total.count ?? 0, unread: unread.count ?? 0, flagged: flagged.count ?? 0 };
    }),
  );

  return rows.map((a, i) => ({
    id: a.id,
    address: a.address,
    displayName: a.display_name,
    provider: a.provider,
    isShared: a.is_shared,
    status: a.status,
    statusDetail: a.status_detail,
    lastSyncedAt: a.last_synced_at,
    imapHost: a.imap_host,
    imapPort: a.imap_port,
    imapUser: a.imap_user,
    smtpHost: a.smtp_host,
    smtpPort: a.smtp_port,
    notes: a.notes ?? "",
    unread: counts[i].unread,
    flagged: counts[i].flagged,
    total: counts[i].total,
  }));
}

// ── アカウント管理（サーバーAPI経由）────────────────────────
async function accountsApi<T>(body: unknown): Promise<T> {
  const res = await apiFetch("/api/mail/accounts", { method: "POST", body });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "処理に失敗しました");
  return j;
}

export const saveAccount = (input: MailAccountInput) =>
  accountsApi<{ id: number }>({ action: "save", ...input });

export const deleteAccount = (id: number) =>
  accountsApi<{ ok: boolean }>({ action: "delete", id });

export const testAccount = (input: MailAccountInput) =>
  accountsApi<{ ok: boolean; error?: string }>({ action: "test", ...input });

// ── メール一覧（フィルタ適用・新しい順）──────────────────────
export async function fetchMessages(accountId: number, filter: MailFilter = {}): Promise<MailMessage[]> {
  let q = supabase
    .from("mail_messages")
    .select(LIST_COLS)
    .eq("account_id", accountId)
    .eq("folder", filter.folder ?? "INBOX")
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(filter.limit ?? 100);

  if (filter.registeredOnly) q = q.not("member_id", "is", null);
  if (filter.flagged) q = q.eq("is_flagged", true);
  if (filter.starred) q = q.eq("is_starred", true);
  if (filter.unread) q = q.eq("is_read", false);

  const term = (filter.q ?? "").trim();
  if (term) {
    // カンマ・括弧は or フィルタの構文を壊すので落とす
    const safe = term.replace(/[,()%]/g, " ").trim();
    if (safe) q = q.or(`subject.ilike.%${safe}%,from_addr.ilike.%${safe}%,from_name.ilike.%${safe}%`);
  }

  const { data, error } = await q;
  if (error) { console.error("fetchMessages", error); return []; }
  return ((data as ListRow[]) ?? []).map(toMessage);
}

// ── 会話（送受信一貫）────────────────────────────────────────
/** アカウント全体（全フォルダ横断）の最近メールを取得。会話ビューのグルーピング元。 */
export async function fetchAllMessages(accountId: number, limit = 400): Promise<MailMessage[]> {
  const { data, error } = await supabase
    .from("mail_messages").select(LIST_COLS)
    .eq("account_id", accountId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) { console.error("fetchAllMessages", error); return []; }
  return ((data as ListRow[]) ?? []).map(toMessage);
}

/** 会話（相手ごとにまとめた束）*/
export interface MailConversation {
  counterpart: string;
  name: string;
  memberId: number | null;
  isMember: boolean;
  lastAt: string | null;
  unread: number;
  messages: MailMessage[];   // 新しい順で保持
}

/** メール配列を相手（counterpart）ごとに束ねて会話にする（新しい会話が先頭）。 */
export function groupConversations(msgs: MailMessage[]): MailConversation[] {
  const map = new Map<string, MailConversation>();
  for (const m of msgs) {
    const key = m.counterpart || m.fromAddr;
    if (!key) continue;
    let c = map.get(key);
    if (!c) {
      c = { counterpart: key, name: "", memberId: m.memberId, isMember: m.isMember, lastAt: m.receivedAt, unread: 0, messages: [] };
      map.set(key, c);
    }
    c.messages.push(m);
    if (m.memberId != null) { c.memberId = m.memberId; c.isMember = true; }
    // 表示名は相手側（受信メールの差出人名）を採用
    if (!c.name && m.direction !== "out" && m.fromName) c.name = m.fromName;
    if ((m.receivedAt ?? "") > (c.lastAt ?? "")) c.lastAt = m.receivedAt;
    if (m.direction !== "out" && !m.isRead) c.unread += 1;
  }
  return [...map.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

// ── 見出し詳細（DBから。本文は含まない）────────────────────
export async function fetchMessage(id: number): Promise<MailMessageFull | null> {
  const { data, error } = await supabase
    .from("mail_messages")
    .select("id, account_id, folder, direction, counterpart, from_name, from_addr, to_addr, subject, member_id, is_read, is_starred, is_flagged, has_attach, received_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) { if (error) console.error("fetchMessage", error); return null; }
  return {
    ...toMessage(data as ListRow),
    toAddr: data.to_addr,
  };
}

// ── フォルダ一覧（サーバー経由でIMAPから）────────────────────
export async function fetchFolders(accountId: number): Promise<MailFolder[]> {
  const res = await apiFetch(`/api/mail/folders?accountId=${accountId}`);
  const j = (await res.json().catch(() => ({}))) as { folders?: MailFolder[]; error?: string };
  if (!res.ok) throw new Error(j.error ?? "フォルダの取得に失敗しました");
  return j.folders ?? [];
}

// ── 本文のオンデマンド取得（サーバー経由でIMAPから）──────────
//   ハイブリッド型：本文はDBに無いため、開いた瞬間にサーバー(API)へ取りにいく。
export async function fetchBody(id: number): Promise<MailBody> {
  const res = await apiFetch("/api/mail/body", { method: "POST", body: { id } });
  const j = (await res.json().catch(() => ({}))) as MailBody & { error?: string };
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "本文の取得に失敗しました");
  return { bodyText: j.bodyText ?? "", bodyHtml: j.bodyHtml ?? "", hasAttach: !!j.hasAttach };
}

// ── マーキング（既読・スター・フラグ）────────────────────────
async function patchMessage(id: number, patch: TablesUpdate<"mail_messages">): Promise<void> {
  const { error } = await supabase.from("mail_messages").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// 既読・スターは DB を即時更新（RLS）しつつ、IMAP(\Seen/\Flagged)へも best-effort で反映する。
export async function markRead(id: number, read = true): Promise<void> {
  await patchMessage(id, { is_read: read });
  void apiFire("/api/mail/flag", { id, isRead: read });
}
export async function setStarred(id: number, v: boolean): Promise<void> {
  await patchMessage(id, { is_starred: v });
  void apiFire("/api/mail/flag", { id, isStarred: v });
}
// フラグ（要対応）はアプリ独自の共有マーク。IMAPには反映せずDBのみ。
export const setFlagged = (id: number, v: boolean) => patchMessage(id, { is_flagged: v });

// ── メール移動（サーバー経由でIMAP MOVE）────────────────────
export async function moveMessage(id: number, targetFolder: string): Promise<void> {
  const res = await apiFetch("/api/mail/move", { method: "POST", body: { id, targetFolder } });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "移動に失敗しました");
  }
}

// ── フォルダ操作（作成/改名/削除）────────────────────────────
async function folderOp(body: unknown): Promise<void> {
  const res = await apiFetch("/api/mail/folder-op", { method: "POST", body });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "フォルダ操作に失敗しました");
  }
}
// ── 送信（サーバー経由でSMTP）────────────────────────────────
export interface SendMailInput { accountId: number; to?: string; subject?: string; text: string; replyToId?: number; }
export async function sendMail(input: SendMailInput): Promise<void> {
  const res = await apiFetch("/api/mail/send", { method: "POST", body: input });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "送信に失敗しました");
  }
}

export const createFolder = (accountId: number, path: string) =>
  folderOp({ accountId, action: "create", path });
export const renameFolder = (accountId: number, path: string, newPath: string) =>
  folderOp({ accountId, action: "rename", path, newPath });
export const deleteFolder = (accountId: number, path: string) =>
  folderOp({ accountId, action: "delete", path });

// ── 受信同期（サーバーでIMAP接続）──────────────────────────
export interface SyncResult {
  address: string; fetched: number; inserted: number; ok: boolean; error?: string;
}

export async function syncMail(): Promise<SyncResult[]> {
  const res = await apiFetch("/api/mail/sync", { method: "POST" });
  const j = (await res.json().catch(() => ({}))) as { results?: SyncResult[]; error?: string };
  if (!res.ok) throw new Error(j.error ?? "同期に失敗しました");
  return j.results ?? [];
}
