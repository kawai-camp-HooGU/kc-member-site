"use client";
// ============================================================
// メール（Phase 1・受信）  view = "mail"（運営のみ）
//   ・アカウント未選択 … メールアドレス一覧（接続状態・未読・フラグ件数）
//   ・アカウント選択中 … 受信ボックス（左：一覧／右：確認ペイン）
//   機能：受信同期／「登録メアドのみ」フィルタ／スター・フラグ・既読
//   ⚠️ 受信本文は body_text をそのまま表示する（HTMLメールの生描画はXSSと
//      外部画像トラッキングの温床になるため Phase 1 では行わない）。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import { fmtJst } from "../lib/dateFmt";
import {
  fetchAccounts, fetchMessages, fetchMessage, fetchBody, fetchFolders,
  markRead, setStarred, setFlagged, syncMail, moveMessage, createFolder, deleteFolder,
  fetchAllMessages, groupConversations, sendMail,
  saveAccount, deleteAccount, testAccount,
} from "../lib/mail";
import type { MailAccount, MailMessage, MailMessageFull, MailBody, MailFilter, MailFolder, MailConversation, MailAccountInput } from "../lib/mail";

// フォルダの用途アイコン（SPECIAL-USE → 絵文字）
const folderIcon = (specialUse: string): string => {
  switch (specialUse) {
    case "\\Sent": return "📤";
    case "\\Drafts": return "📝";
    case "\\Trash": return "🗑";
    case "\\Junk": return "⚠";
    case "\\Archive": return "🗄";
    default: return "📁";
  }
};
// 受信トレイ(INBOX)は先頭・日本語名で表示
const folderLabel = (f: MailFolder): string => (f.path === "INBOX" ? "受信トレイ" : f.name);

const fmt = (s: string | null) => (s ? fmtJst(s) : "");
const initial = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function StatusDot({ status }: { status: string }) {
  const color = status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  const label = status === "connected" ? "接続中" : status === "error" ? "認証エラー" : "停止中";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`w-2 h-2 rounded-full ${color}`} />{label}
    </span>
  );
}

// ── アカウント追加／編集フォーム（モーダル）────────────────
const fieldCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400";

function AccountForm({
  editing, onClose, onSaved,
}: {
  editing: MailAccount | null; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = !!editing;
  const [address, setAddress] = useState(editing?.address ?? "");
  const [label, setLabel] = useState(editing?.displayName ?? "");
  const [host, setHost] = useState(editing?.imapHost ?? "");
  const [port, setPort] = useState(String(editing?.imapPort ?? 993));
  const [user, setUser] = useState(editing?.imapUser ?? "");
  const [password, setPassword] = useState("");
  const [shared, setShared] = useState(editing?.isShared ?? true);
  const [smtpHost, setSmtpHost] = useState(editing?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(editing?.smtpPort ?? 465));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const input = (): MailAccountInput => ({
    id: editing?.id, address: address.trim(), label: label.trim(), host: host.trim(),
    port: Number(port) || 993, user: user.trim(), password: password || undefined, shared,
    smtpHost: smtpHost.trim(), smtpPort: Number(smtpPort) || 465, notes,
  });

  const doTest = async () => {
    setBusy(true); setTestMsg(null);
    try {
      const r = await testAccount(input());
      setTestMsg(r.ok ? { ok: true, text: "接続に成功しました" } : { ok: false, text: r.error ?? "接続に失敗しました" });
    } catch (e: unknown) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : "接続に失敗しました" });
    } finally { setBusy(false); }
  };

  const doSave = async () => {
    if (!address.includes("@")) { toast.error("メールアドレスを正しく入力してください"); return; }
    if (!host.trim()) { toast.error("IMAPホストを入力してください"); return; }
    if (!isEdit && !password) { toast.error("パスワードを入力してください"); return; }
    setBusy(true);
    try {
      await saveAccount(input());
      toast.success(isEdit ? "アカウントを更新しました" : "アカウントを追加しました");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!editing) return;
    if (!(await confirm({ title: "アカウントを削除", message: `${editing.address} を削除しますか？受信済みのメールも表示されなくなります。`, confirmLabel: "削除する", danger: true }))) return;
    setBusy(true);
    try {
      await deleteAccount(editing.id);
      toast.success("削除しました");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "削除に失敗しました");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center">
          <h2 className="text-base font-extrabold">{isEdit ? "アカウントを編集" : "アカウントを追加"}</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-gray-600">メールアドレス <span className="text-red-500">*</span></label>
            <input className={fieldCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="support@example.jp" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600">表示名（用途）</label>
            <input className={fieldCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="問い合わせ窓口" />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-600">IMAPホスト <span className="text-red-500">*</span></label>
              <input className={fieldCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="sv1234.xserver.jp" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600">ポート</label>
              <input className={fieldCls} value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600">IMAPユーザー</label>
            <input className={fieldCls} value={user} onChange={(e) => setUser(e.target.value)} placeholder="（空欄ならメールアドレスを使用）" />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-600">SMTPホスト（送信用）</label>
              <input className={fieldCls} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="（空欄なら送信不可）" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600">ポート</label>
              <input className={fieldCls} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="465" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600">パスワード {!isEdit && <span className="text-red-500">*</span>}</label>
            <input type="password" className={fieldCls} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "変更する場合のみ入力" : "IMAPのパスワード"} autoComplete="new-password" />
            <p className="text-[11px] text-gray-400 mt-1">暗号化してサーバーに保存されます（画面には二度と表示されません）。</p>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <button type="button" onClick={() => setShared(!shared)}
              className={`relative w-9 h-[19px] rounded-full shrink-0 ${shared ? "bg-blue-500" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 w-[15px] h-[15px] rounded-full bg-white transition-all ${shared ? "left-[19px]" : "left-0.5"}`} />
            </button>
            共有窓口として扱う
          </label>
          <div>
            <label className="text-xs font-bold text-gray-600">特記事項</label>
            <textarea className={`${fieldCls} resize-y whitespace-pre-wrap`} rows={4} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="運用メモ・注意点など（改行可）" />
          </div>

          {testMsg && (
            <div className={`text-xs rounded-lg px-3 py-2 ${testMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {testMsg.ok ? "✓ " : "✕ "}{testMsg.text}
            </div>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-gray-100 flex items-center gap-2">
          {isEdit && (
            <button onClick={doDelete} disabled={busy} className="text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 disabled:opacity-50">削除</button>
          )}
          <button onClick={doTest} disabled={busy} className="ml-auto text-sm font-bold rounded-lg px-3.5 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-50">接続テスト</button>
          <button onClick={doSave} disabled={busy} className="text-sm font-bold rounded-lg px-4 py-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{busy ? "処理中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

// ── メール ブランドバー（LINEのLineAccountBarと同じ思想の共用ヘッダー）──
//   青の色帯＋丸アイコン＋アドレス＋「MAIL」バッジ＋右のプルダウンでアカウント切替。
function MailAccountBar({
  accounts, accountId, onSelect, screenLabel,
}: {
  accounts: MailAccount[]; accountId: number; onSelect: (id: number) => void; screenLabel?: string;
}) {
  const acc = accounts.find((a) => a.id === accountId) ?? accounts[0];
  if (!acc) return null;
  const note = (acc.notes ?? "").split("\n")[0].trim();   // 特記事項は先頭行を要約表示
  const sub = [note, screenLabel].filter(Boolean).join(" ／ ");
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl mb-3" style={{ background: "linear-gradient(90deg,#2563eb,#1d4ed8)" }}>
      <span className="w-9 h-9 rounded-full bg-white grid place-items-center text-[#1d4ed8] font-extrabold text-sm flex-shrink-0">{initial(acc.address)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <b className="text-white text-[15px] truncate max-w-[280px]">{acc.address}</b>
          <span className="text-[10px] font-extrabold text-[#1d4ed8] bg-white rounded-full px-2 py-0.5 flex-shrink-0">MAIL</span>
        </div>
        {sub && <div className="text-[11px] text-white/85 truncate">{sub}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {acc.unread > 0 && <span className="text-[10px] font-extrabold text-[#1d4ed8] bg-white rounded-full px-2 py-0.5">未読 {acc.unread}</span>}
        {accounts.length > 1 && (
          <select value={accountId} onChange={(e) => onSelect(Number(e.target.value))}
            className="text-[12px] font-bold text-white bg-white/20 border border-white/30 rounded-lg px-2 py-1 max-w-[190px]" title="参照アカウントを切り替え">
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="text-gray-800">{a.address}{a.unread > 0 ? ` (${a.unread})` : ""}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ── アカウント一覧 ──────────────────────────────────────────
function AccountList({
  accounts, loading, syncing, onOpen, onSync, onAdd, onEdit,
}: {
  accounts: MailAccount[]; loading: boolean; syncing: boolean;
  onOpen: (a: MailAccount) => void; onSync: () => void;
  onAdd: () => void; onEdit: (a: MailAccount) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div>
          <h1 className="text-lg font-extrabold">メール</h1>
          <p className="text-xs text-gray-500">連携アカウント一覧</p>
        </div>
        <button onClick={onSync} disabled={syncing}
          className="ml-auto text-sm font-bold rounded-lg px-3.5 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          {syncing ? "同期中…" : "↻ 受信同期"}
        </button>
        <button onClick={onAdd}
          className="text-sm font-bold rounded-lg px-3.5 py-2 bg-red-600 text-white hover:bg-red-700">
          ＋ アカウントを追加
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-gray-400 text-sm">読み込み中…</div>
      ) : accounts.length === 0 ? (
        <div className="p-10 text-center text-gray-500 text-sm leading-relaxed">
          連携アカウントがありません。<br />
          右上の「<b>＋ アカウントを追加</b>」から IMAP アカウントを登録してください。
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 border-b border-gray-100">
              <th className="px-5 py-2.5 font-bold">メールアドレス</th>
              <th className="px-3 py-2.5 font-bold">種別</th>
              <th className="px-3 py-2.5 font-bold">状態</th>
              <th className="px-3 py-2.5 font-bold text-center">未読</th>
              <th className="px-3 py-2.5 font-bold text-center">フラグ</th>
              <th className="px-3 py-2.5 font-bold">特記事項</th>
              <th className="px-3 py-2.5 font-bold">最終同期</th>
              <th className="px-3 py-2.5 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} onClick={() => onOpen(a)}
                className="border-b border-gray-100 last:border-0 hover:bg-slate-50 cursor-pointer">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 grid place-items-center font-bold text-[11px]">
                      {initial(a.displayName || a.address)}
                    </span>
                    <div>
                      <div className="font-bold">{a.address}</div>
                      {a.displayName && a.displayName !== a.address && (
                        <div className="text-[11px] text-gray-500">{a.displayName}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${a.isShared ? "bg-blue-100 text-blue-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {a.isShared ? "共有" : "個人"}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <StatusDot status={a.status} />
                  {a.status === "error" && a.statusDetail && (
                    <div className="text-[10.5px] text-red-500 mt-0.5 max-w-[220px] truncate" title={a.statusDetail}>{a.statusDetail}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-center font-bold text-blue-700">{a.unread > 0 ? a.unread : <span className="text-gray-300">0</span>}</td>
                <td className="px-3 py-3 text-center">{a.flagged > 0 ? <span className="text-red-600 font-bold">⚑ {a.flagged}</span> : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-3">
                  {a.notes.trim() ? (
                    <div className="flex items-start gap-1.5 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 max-w-[260px] whitespace-pre-wrap break-words" title={a.notes}>
                      <span className="text-amber-500 shrink-0">✎</span><span className="line-clamp-3">{a.notes}</span>
                    </div>
                  ) : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-3 py-3 text-gray-500 text-xs">{fmt(a.lastSyncedAt) || "未同期"}</td>
                <td className="px-3 py-3 text-right">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(a); }}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1">編集</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── フィルタトグル ──────────────────────────────────────────
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs font-bold rounded-lg px-3 py-1.5 border transition-colors ${on ? "bg-blue-100 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
      {children}
    </button>
  );
}

// ── 受信ボックス ────────────────────────────────────────────
function Inbox({
  account, onBack, onCountsChanged,
}: {
  account: MailAccount; onBack?: () => void; onCountsChanged: () => void;
}) {
  const { members } = useMaster();
  const toast = useToast();
  const confirm = useConfirm();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [full, setFull] = useState<MailMessageFull | null>(null);
  const [body, setBody] = useState<MailBody | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyErr, setBodyErr] = useState<string>("");
  // 取得済み本文のキャッシュ（同一セッション内は再取得しない）と、ホバー先読みの多重防止
  const bodyCache = useRef<Map<number, MailBody>>(new Map());
  const inflight = useRef<Set<number>>(new Set());
  const reqRef = useRef<number | null>(null);   // 最後に開こうとしたメールID（取得レースの取り違え防止）
  const [filter, setFilter] = useState<MailFilter>({ registeredOnly: false, folder: "INBOX" });
  const [q, setQ] = useState("");
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [compose, setCompose] = useState<null | { mode: "reply" | "forward"; to: string; subject: string; text: string; replyToId?: number }>(null);
  const [sending, setSending] = useState(false);

  const memberName = (id: number | null) =>
    id != null ? (members.find((m) => m.id === id)?.name ?? "") : "";

  const load = useCallback(async () => {
    setLoading(true);
    setMessages(await fetchMessages(account.id, { ...filter, q }));
    setLoading(false);
  }, [account.id, filter, q]);

  useEffect(() => { void load(); }, [load]);

  // フォルダ一覧を取得（IMAP経由）
  const loadFolders = useCallback(async () => {
    try { setFolders(await fetchFolders(account.id)); }
    catch { /* 取得失敗時はフォルダ列を出さない */ }
  }, [account.id]);
  useEffect(() => { void loadFolders(); }, [loadFolders]);

  // 現在のメールを別フォルダへ移動
  const doMove = async (targetFolder: string) => {
    if (!full) return;
    const id = full.id;
    try {
      await moveMessage(id, targetFolder);
      setMessages((prev) => prev.filter((x) => x.id !== id));
      setSelId(null); setFull(null); setBody(null);
      toast.success("移動しました");
      void loadFolders();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "移動に失敗しました");
    }
  };

  // フォルダ作成
  const doAddFolder = async () => {
    const name = newFolder.trim();
    if (!name) { setAddingFolder(false); return; }
    try {
      await createFolder(account.id, name);
      toast.success("フォルダを作成しました");
      setNewFolder(""); setAddingFolder(false);
      await loadFolders();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "作成に失敗しました");
    }
  };

  // フォルダ削除（カスタムフォルダのみ）
  const doDeleteFolder = async (f: MailFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirm({ title: "フォルダを削除", message: `「${f.name}」を削除しますか？中のメールも表示されなくなります。`, confirmLabel: "削除する", danger: true }))) return;
    try {
      await deleteFolder(account.id, f.path);
      toast.success("削除しました");
      if ((filter.folder ?? "INBOX") === f.path) setF({ folder: "INBOX" });
      await loadFolders();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  // 本文をIMAPから取得しキャッシュする（open/prefetch 共通）。多重取得を防ぐ。
  const loadBody = useCallback(async (id: number): Promise<MailBody | null> => {
    const cached = bodyCache.current.get(id);
    if (cached) return cached;
    if (inflight.current.has(id)) return null;
    inflight.current.add(id);
    try {
      const b = await fetchBody(id);
      bodyCache.current.set(id, b);
      return b;
    } finally {
      inflight.current.delete(id);
    }
  }, []);

  // 一覧の行にホバーしたら本文を先読み（クリック時には表示済みで体感が速い）
  const prefetch = (m: MailMessage) => {
    if (bodyCache.current.has(m.id) || inflight.current.has(m.id)) return;
    void loadBody(m.id).catch(() => {});
  };

  const open = async (m: MailMessage) => {
    reqRef.current = m.id;
    setSelId(m.id);
    setBodyErr("");
    setFull(await fetchMessage(m.id));
    // キャッシュ（先読み含む）があれば即表示。無ければ取得する。
    const cached = bodyCache.current.get(m.id);
    if (cached) {
      setBody(cached); setBodyLoading(false);
    } else {
      setBody(null); setBodyLoading(true);
      try {
        const b = await loadBody(m.id);
        if (reqRef.current === m.id) {   // 取得中に別メールへ切り替わっていなければ反映
          if (b) setBody(b);
          else setBodyErr("本文の取得に失敗しました");
        }
      } catch (e: unknown) {
        if (reqRef.current === m.id) setBodyErr(e instanceof Error ? e.message : "本文の取得に失敗しました");
      } finally {
        if (reqRef.current === m.id) setBodyLoading(false);
      }
    }
    if (!m.isRead) {
      await markRead(m.id, true).catch(() => {});
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isRead: true } : x)));
      onCountsChanged();
    }
  };

  const toggleStar = async (m: MailMessage, e: React.MouseEvent) => {
    e.stopPropagation();
    const v = !m.isStarred;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isStarred: v } : x)));
    if (full?.id === m.id) setFull({ ...full, isStarred: v });
    await setStarred(m.id, v).catch(() => toast.error("スターの更新に失敗しました"));
  };
  const toggleFlag = async (m: MailMessage, e: React.MouseEvent) => {
    e.stopPropagation();
    const v = !m.isFlagged;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isFlagged: v } : x)));
    if (full?.id === m.id) setFull({ ...full, isFlagged: v });
    await setFlagged(m.id, v).catch(() => toast.error("フラグの更新に失敗しました"));
    onCountsChanged();
  };

  // 返信・転送
  const openReply = () => {
    if (!full) return;
    setCompose({ mode: "reply", to: full.fromAddr, subject: /^\s*re:/i.test(full.subject) ? full.subject : `Re: ${full.subject}`, text: "", replyToId: full.id });
  };
  const openForward = () => {
    if (!full) return;
    const quoted = body?.bodyText ? `\n\n--- 転送メッセージ ---\n${body.bodyText}` : "";
    setCompose({ mode: "forward", to: "", subject: /^\s*fwd?:/i.test(full.subject) ? full.subject : `Fwd: ${full.subject}`, text: quoted });
  };
  const doSend = async () => {
    if (!compose || !compose.to.trim() || !compose.text.trim()) { toast.error("宛先と本文を入力してください"); return; }
    setSending(true);
    try {
      await sendMail({ accountId: account.id, to: compose.to.trim(), subject: compose.subject, text: compose.text, replyToId: compose.replyToId });
      toast.success("送信しました");
      setCompose(null);
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
    } finally { setSending(false); }
  };

  const setF = (patch: Partial<MailFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const curPath = filter.folder ?? "INBOX";
  const curFolder = folders.find((f) => f.path === curPath);
  const curTitle = curFolder ? folderLabel(curFolder) : "受信トレイ";

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col h-[72vh] min-h-[520px]">
      {/* ヘッダ */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        {onBack && <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">← 一覧</button>}
        <div>
          <h1 className="text-base font-extrabold leading-tight">{curTitle}</h1>
          <p className="text-[11px] text-gray-500">{account.address}</p>
        </div>
      </div>
      {/* ツールバー */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 メールを検索"
          className="flex-1 min-w-[180px] max-w-[340px] bg-gray-100 border border-gray-200 rounded-lg h-8 px-3 text-xs focus:outline-none focus:border-blue-300" />
        <Chip on={!!filter.registeredOnly} onClick={() => setF({ registeredOnly: !filter.registeredOnly })}>
          <span className="inline-flex items-center gap-1.5">
            <span className={`relative w-8 h-[17px] rounded-full ${filter.registeredOnly ? "bg-blue-500" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 w-[13px] h-[13px] rounded-full bg-white ${filter.registeredOnly ? "left-[17px]" : "left-0.5"}`} />
            </span>
            登録メアドのみ
          </span>
        </Chip>
        <Chip on={!!filter.flagged} onClick={() => setF({ flagged: !filter.flagged })}>⚑ フラグ</Chip>
        <Chip on={!!filter.starred} onClick={() => setF({ starred: !filter.starred })}>★ スター</Chip>
        <Chip on={!!filter.unread} onClick={() => setF({ unread: !filter.unread })}>● 未読</Chip>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* フォルダ一覧 */}
        {folders.length > 0 && (
          <div className="w-[160px] shrink-0 border-r border-gray-100 overflow-y-auto py-2 bg-gray-50/50">
            {folders.map((f) => {
              const on = curPath === f.path;
              const custom = f.specialUse === "" && f.path !== "INBOX";
              return (
                <div key={f.path} className={`group w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer ${on ? "bg-blue-500 text-white" : "text-gray-700 hover:bg-gray-100"}`}
                  onClick={() => { setF({ folder: f.path }); setSelId(null); setFull(null); setBody(null); }}>
                  <span>{folderIcon(f.specialUse)}</span>
                  <span className="flex-1 truncate">{folderLabel(f)}</span>
                  {custom && (
                    <button onClick={(e) => doDeleteFolder(f, e)} title="削除"
                      className={`hidden group-hover:block text-[13px] leading-none ${on ? "text-white/80" : "text-gray-400 hover:text-red-500"}`}>×</button>
                  )}
                  {f.unread > 0 && <span className={`text-[10px] font-bold ${on ? "text-white/80" : "text-blue-600"}`}>{f.unread}</span>}
                </div>
              );
            })}
            {/* フォルダ追加 */}
            {addingFolder ? (
              <div className="px-2 py-2">
                <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void doAddFolder(); if (e.key === "Escape") { setAddingFolder(false); setNewFolder(""); } }}
                  onBlur={() => void doAddFolder()} placeholder="フォルダ名"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-blue-400" />
              </div>
            ) : (
              <button onClick={() => setAddingFolder(true)}
                className="w-full text-left px-3 py-2 text-[11px] text-blue-600 font-bold hover:bg-gray-100">＋ フォルダ追加</button>
            )}
          </div>
        )}
        {/* メール一覧 */}
        <div className="flex-1 min-w-[280px] border-r border-gray-100 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">読み込み中…</div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">該当するメールはありません</div>
          ) : messages.map((m) => (
            <div key={m.id} onClick={() => open(m)} onMouseEnter={() => prefetch(m)}
              className={`flex gap-2.5 px-4 py-3 border-b border-gray-100 cursor-pointer ${selId === m.id ? "bg-blue-50 shadow-[inset_3px_0_0_#2563eb]" : "hover:bg-slate-50"}`}>
              <div className="flex flex-col items-center gap-2 pt-0.5">
                <button onClick={(e) => toggleStar(m, e)} className={`text-[15px] leading-none ${m.isStarred ? "text-amber-500" : "text-gray-300 hover:text-gray-400"}`}>★</button>
                <button onClick={(e) => toggleFlag(m, e)} className={`text-[13px] leading-none ${m.isFlagged ? "text-red-600" : "text-gray-300 hover:text-gray-400"}`}>⚑</button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {!m.isRead && <span className="w-[7px] h-[7px] rounded-full bg-blue-500 shrink-0" />}
                  <span className={`text-[13px] truncate max-w-[170px] ${m.isRead ? "font-semibold text-gray-600" : "font-extrabold text-gray-900"}`}>
                    {m.fromName || m.fromAddr}
                  </span>
                  {m.isMember && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">会員</span>}
                  <span className="ml-auto text-[11px] text-gray-400 shrink-0">{fmt(m.receivedAt)}</span>
                </div>
                <div className={`text-[12.5px] mt-0.5 truncate ${m.isRead ? "font-semibold text-gray-600" : "font-bold text-gray-900"}`}>{m.subject || "（件名なし）"}</div>
                {m.hasAttach && <div className="text-[11px] text-gray-400 mt-0.5">📎 添付あり</div>}
              </div>
            </div>
          ))}
        </div>

        {/* 確認ペイン */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!full ? (
            <div className="h-full grid place-items-center text-gray-400 text-sm p-8">メールを選択してください</div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                <div className="flex items-start gap-2 mb-3">
                  {full.isFlagged && <span className="text-red-600 text-base leading-6">⚑</span>}
                  <h2 className="text-base font-extrabold leading-snug">{full.subject || "（件名なし）"}</h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 grid place-items-center font-bold">{initial(full.fromName || full.fromAddr)}</span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-extrabold flex items-center gap-2">
                      {full.fromName || full.fromAddr}
                      {full.isMember && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          会員{memberName(full.memberId) ? `・${memberName(full.memberId)}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">{full.fromAddr}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">{fmt(full.receivedAt)}</span>
                    {folders.length > 1 && (
                      <select value="" onChange={(e) => { if (e.target.value) void doMove(e.target.value); }} title="フォルダへ移動"
                        className="h-8 rounded-lg border border-gray-200 text-[11px] text-gray-600 px-1.5 max-w-[110px]">
                        <option value="">移動 ▾</option>
                        {folders.filter((f) => f.path !== curPath).map((f) => (
                          <option key={f.path} value={f.path}>{folderLabel(f)}</option>
                        ))}
                      </select>
                    )}
                    <button onClick={(e) => toggleStar(full, e)} title="スター"
                      className={`w-8 h-8 rounded-lg border grid place-items-center text-base ${full.isStarred ? "text-amber-500 border-amber-200 bg-amber-50" : "text-gray-400 border-gray-200"}`}>★</button>
                    <button onClick={(e) => toggleFlag(full, e)} title="フラグ（要対応）"
                      className={`w-8 h-8 rounded-lg border grid place-items-center text-sm ${full.isFlagged ? "text-red-600 border-red-200 bg-red-50" : "text-gray-400 border-gray-200"}`}>⚑</button>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap break-words">
                {bodyLoading ? (
                  <span className="text-gray-400">本文を読み込み中…</span>
                ) : bodyErr ? (
                  <span className="text-red-500">{bodyErr}</span>
                ) : body?.bodyText?.trim()
                  ? body.bodyText
                  : body?.bodyHtml
                    ? "（このメールは HTML 形式です。本文テキストのみ表示します）"
                    : "（本文がありません）"}
              </div>
              {compose ? (
                <div className="border-t border-gray-100 bg-white px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-bold text-gray-500 w-10">宛先</span>
                    <input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400" placeholder="送信先メールアドレス" />
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-bold text-gray-500 w-10">件名</span>
                    <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400" />
                  </div>
                  <textarea value={compose.text} onChange={(e) => setCompose({ ...compose, text: e.target.value })} rows={4}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-[12px] resize-none focus:outline-none focus:border-blue-400" placeholder="本文" />
                  <div className="flex gap-2">
                    <button onClick={() => setCompose(null)} className="text-sm font-bold rounded-lg px-3 py-1.5 border border-gray-200 hover:bg-gray-50">キャンセル</button>
                    <button onClick={doSend} disabled={sending} className="ml-auto text-sm font-bold rounded-lg px-4 py-1.5 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{sending ? "送信中…" : "送信"}</button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50 flex items-center gap-2">
                  {account.smtpHost ? (
                    <>
                      <button onClick={openReply} className="text-sm font-bold rounded-lg px-3.5 py-1.5 bg-red-600 text-white hover:bg-red-700">↩ 返信</button>
                      <button onClick={openForward} className="text-sm font-bold rounded-lg px-3.5 py-1.5 border border-gray-200 hover:bg-white">⇒ 転送</button>
                    </>
                  ) : (
                    <span className="text-[11px] text-gray-400">送信するには、アカウント編集で SMTP ホストを設定してください。</span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-400">{(body?.hasAttach ?? full.hasAttach) && "📎 添付あり"}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ルート ──────────────────────────────────────────────────
export function MailView() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sel, setSel] = useState<MailAccount | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MailAccount | null>(null);

  const reloadAccounts = useCallback(async () => {
    const list = await fetchAccounts();
    setAccounts(list);
    setSel((cur) => (cur ? list.find((a) => a.id === cur.id) ?? cur : cur));
  }, []);

  useEffect(() => { (async () => { await reloadAccounts(); setLoading(false); })(); }, [reloadAccounts]);

  const doSync = async () => {
    setSyncing(true);
    try {
      const results = await syncMail();
      const inserted = results.reduce((n, r) => n + r.inserted, 0);
      const failed = results.filter((r) => !r.ok);
      await reloadAccounts();
      if (failed.length > 0) toast.error(`同期エラー：${failed.map((f) => f.address).join(", ")}`);
      else toast.success(inserted > 0 ? `新着 ${inserted} 件を取り込みました` : "新着はありませんでした");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setSyncing(false);
    }
  };

  if (sel) {
    return <Inbox account={sel} onBack={() => setSel(null)} onCountsChanged={reloadAccounts} />;
  }
  return (
    <>
      <AccountList accounts={accounts} loading={loading} syncing={syncing}
        onOpen={setSel} onSync={doSync}
        onAdd={() => { setEditing(null); setFormOpen(true); }}
        onEdit={(a) => { setEditing(a); setFormOpen(true); }} />
      {formOpen && (
        <AccountForm editing={editing} onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); await reloadAccounts(); }} />
      )}
    </>
  );
}

// ── Mailbox（受信トレイ・専用メニュー）────────────────────────
//   親メニュー「メール」の子。アカウントを選んで受信ボックスを直接開く。
//   アカウントが1つならそのまま、複数なら上部の切替チップで選ぶ。
export function MailboxView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const list = await fetchAccounts();
    setAccounts(list);
    setSelId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => { (async () => { await reload(); setLoading(false); })(); }, [reload]);

  if (loading) {
    return <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400 text-sm">読み込み中…</div>;
  }
  if (accounts.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-500 text-sm leading-relaxed">
        連携アカウントがありません。<br />
        「メール › アカウント一覧」から IMAP アカウントを登録してください。
      </div>
    );
  }

  const sel = accounts.find((a) => a.id === selId) ?? accounts[0];
  return (
    <div>
      <MailAccountBar accounts={accounts} accountId={sel.id} onSelect={setSelId} screenLabel="受信トレイ" />
      <Inbox account={sel} onCountsChanged={reload} />
    </div>
  );
}

// ── 会話（送受信一貫）本体 ──────────────────────────────────
function Conversations({ account }: { account: MailAccount }) {
  const { members } = useMaster();
  const toast = useToast();
  const [convs, setConvs] = useState<MailConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);   // 選択中の相手（counterpart）
  const [bodies, setBodies] = useState<Record<number, MailBody | null>>({}); // msgId→本文（null=読込中）
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const memberName = (id: number | null) =>
    id != null ? (members.find((m) => m.id === id)?.name ?? "") : "";

  const load = useCallback(async () => {
    setLoading(true);
    setConvs(groupConversations(await fetchAllMessages(account.id)));
    setLoading(false);
  }, [account.id]);
  useEffect(() => { void load(); }, [load]);

  const cur = convs.find((c) => c.counterpart === sel) ?? null;
  const timeline = cur ? [...cur.messages].sort((a, b) => (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "")) : [];

  const toggleBody = async (m: MailMessage) => {
    if (m.id in bodies) { setBodies((p) => { const n = { ...p }; delete n[m.id]; return n; }); return; }
    setBodies((p) => ({ ...p, [m.id]: null }));
    try { const b = await fetchBody(m.id); setBodies((p) => ({ ...p, [m.id]: b })); }
    catch { setBodies((p) => ({ ...p, [m.id]: { bodyText: "（本文の取得に失敗しました）", bodyHtml: "", hasAttach: false } })); }
  };

  // 返信を送信（宛先＝相手、件名は直近メールから Re: を補完）
  const doReply = async (msgs: MailMessage[]) => {
    if (!cur || !reply.trim()) return;
    const last = msgs[msgs.length - 1];
    setSending(true);
    try {
      await sendMail({ accountId: account.id, to: cur.counterpart, replyToId: last?.id, text: reply.trim() });
      setReply("");
      toast.success("送信しました");
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
    } finally { setSending(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden flex h-[72vh] min-h-[520px]">
      {/* 会話一覧 */}
      <div className="w-[280px] shrink-0 border-r border-gray-100 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <h1 className="text-base font-extrabold leading-tight">会話</h1>
          <p className="text-[11px] text-gray-500">{account.address}</p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">読み込み中…</div>
        ) : convs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">会話がありません（受信同期してください）</div>
        ) : convs.map((c) => (
          <button key={c.counterpart} onClick={() => setSel(c.counterpart)}
            className={`w-full text-left px-4 py-3 border-b border-gray-100 ${sel === c.counterpart ? "bg-blue-50 shadow-[inset_3px_0_0_#2563eb]" : "hover:bg-slate-50"}`}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold truncate">{c.name || c.counterpart}</span>
              {c.isMember && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">会員</span>}
              {c.unread > 0 && <span className="ml-auto text-[10px] font-bold text-blue-600">{c.unread}</span>}
            </div>
            <div className="text-[11px] text-gray-400 truncate">{c.counterpart}</div>
            <div className="text-[10.5px] text-gray-400 mt-0.5">{fmt(c.lastAt)} ・ {c.messages.length}件</div>
          </button>
        ))}
      </div>
      {/* タイムライン */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {!cur ? (
          <div className="h-full grid place-items-center text-gray-400 text-sm p-8">会話を選択してください</div>
        ) : (
          <>
            <div className="h-[52px] bg-white border-b border-gray-100 flex items-center gap-2.5 px-4">
              <span className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 grid place-items-center font-bold">{initial(cur.name || cur.counterpart)}</span>
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold truncate">{cur.name || cur.counterpart}{cur.isMember && memberName(cur.memberId) ? `（${memberName(cur.memberId)}）` : ""}</div>
                <div className="text-[11px] text-gray-500 truncate">{cur.counterpart}</div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {timeline.map((m) => {
                const out = m.direction === "out";
                const opened = m.id in bodies;
                const b = bodies[m.id];
                return (
                  <div key={m.id} className={`max-w-[76%] ${out ? "self-end" : "self-start"}`}>
                    <div className={`rounded-2xl px-4 py-2.5 border ${out ? "bg-blue-50 border-blue-100" : "bg-white border-gray-200"}`}>
                      <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1">
                        <span className={`font-bold ${out ? "text-blue-700" : "text-emerald-700"}`}>{out ? "送信" : "受信"}</span>
                        {m.hasAttach && <span>📎</span>}
                        <span className="ml-auto">{fmt(m.receivedAt)}</span>
                      </div>
                      <div className="text-[12.5px] font-bold text-gray-900">{m.subject || "（件名なし）"}</div>
                      {opened && (
                        <div className="text-[12px] mt-1.5 whitespace-pre-wrap break-words text-gray-700">
                          {b === null ? "本文を読み込み中…" : (b.bodyText?.trim() || "（本文なし）")}
                        </div>
                      )}
                      <button onClick={() => toggleBody(m)} className="text-[11px] text-blue-600 font-bold mt-1">{opened ? "閉じる" : "本文を表示"}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {account.smtpHost ? (
              <div className="border-t border-gray-100 bg-white px-3 py-2.5 flex items-end gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                  placeholder={`${cur.name || cur.counterpart} に返信…`}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12px] resize-none focus:outline-none focus:border-blue-400" />
                <button onClick={() => doReply(timeline)} disabled={sending || !reply.trim()}
                  className="text-sm font-bold rounded-lg px-4 py-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 shrink-0">{sending ? "送信中…" : "送信"}</button>
              </div>
            ) : (
              <div className="border-t border-gray-100 bg-white px-4 py-2.5 text-[11px] text-gray-400">送信するには、アカウント編集で SMTP ホストを設定してください。</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── 会話ビュー（メニュー「会話」）: アカウントを選んで会話を開く ──
export function MailThreadsView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const list = await fetchAccounts();
      setAccounts(list);
      setSelId((cur) => cur ?? list[0]?.id ?? null);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400 text-sm">読み込み中…</div>;
  if (accounts.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-500 text-sm leading-relaxed">
        連携アカウントがありません。<br />「メール › アカウント一覧」から IMAP アカウントを登録してください。
      </div>
    );
  }
  const sel = accounts.find((a) => a.id === selId) ?? accounts[0];
  return (
    <div>
      <MailAccountBar accounts={accounts} accountId={sel.id} onSelect={setSelId} screenLabel="会話" />
      <Conversations account={sel} />
    </div>
  );
}
