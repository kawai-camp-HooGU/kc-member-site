// ============================================================
// メール（Phase 1・受信）：クライアント側の読み取り／マーキング
//   ・アカウント一覧／メール一覧／本文取得／既読・スター・フラグ … RLS(運営)で直接 supabase
//   ・受信同期（IMAP接続）… サーバー（/api/mail/sync）でのみ実行
//   （lib/bookmarks.ts と同じ「読みはRLS直・特権処理はAPI」の分担）
// ============================================================
import { supabase } from "./supabase";
import { apiFetch } from "./apiClient";
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
}

/** 一覧行（見出しのみ・本文もプレビューも持たない）*/
export interface MailMessage {
  id: number;
  accountId: number;
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
  registeredOnly?: boolean;  // リスト登録されている会員のメアドのみ
  flagged?: boolean;
  starred?: boolean;
  unread?: boolean;
  q?: string;
  limit?: number;
}

const LIST_COLS =
  "id, account_id, from_name, from_addr, subject, member_id, is_read, is_starred, is_flagged, has_attach, received_at";

interface ListRow {
  id: number; account_id: number; from_name: string; from_addr: string;
  subject: string; member_id: number | null;
  is_read: boolean; is_starred: boolean; is_flagged: boolean;
  has_attach: boolean; received_at: string | null;
}

const toMessage = (r: ListRow): MailMessage => ({
  id: r.id,
  accountId: r.account_id,
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
    .select("id, address, display_name, provider, is_shared, status, status_detail, last_synced_at, sort_order, imap_host, imap_port, imap_user")
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

// ── 見出し詳細（DBから。本文は含まない）────────────────────
export async function fetchMessage(id: number): Promise<MailMessageFull | null> {
  const { data, error } = await supabase
    .from("mail_messages")
    .select("id, account_id, from_name, from_addr, to_addr, subject, member_id, is_read, is_starred, is_flagged, has_attach, received_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) { if (error) console.error("fetchMessage", error); return null; }
  return {
    ...toMessage(data as ListRow),
    toAddr: data.to_addr,
  };
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

export const markRead   = (id: number, read = true) => patchMessage(id, { is_read: read });
export const setStarred = (id: number, v: boolean)  => patchMessage(id, { is_starred: v });
export const setFlagged = (id: number, v: boolean)  => patchMessage(id, { is_flagged: v });

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
