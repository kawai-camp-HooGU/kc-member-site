"use client";
// ============================================================
// メール（Phase 1・受信）  view = "mail"（運営のみ）
//   ・アカウント未選択 … メールアドレス一覧（接続状態・未読・フラグ件数）
//   ・アカウント選択中 … 受信ボックス（左：一覧／右：確認ペイン）
//   機能：受信同期／「登録メアドのみ」フィルタ／スター・フラグ・既読
//   ⚠️ 受信本文は body_text をそのまま表示する（HTMLメールの生描画はXSSと
//      外部画像トラッキングの温床になるため Phase 1 では行わない）。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { useAccountAccess } from "../hooks/useAccountAccess";
import { useRoute } from "../hooks/useRoute";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import { fmtJst } from "../lib/dateFmt";
import {
  fetchAccounts, fetchMessages, fetchMessage, fetchBody, fetchFolders,
  markRead, setStarred, setFlagged, syncMail, moveMessage, createFolder, deleteFolder,
  fetchAllMessages, groupConversations, sendMail, saveDraft, deleteMailMessage,
  listAttachments, downloadAttachment,
  listTemplates, saveTemplate, deleteTemplate,
  scheduleMail, listScheduled, cancelScheduled,
  saveAccount, deleteAccount, testAccount,
} from "../lib/mail";
import type { MailAttachment, AttachmentMeta, MailTemplate, ScheduledMail } from "../lib/mail";
import { linkify } from "../lib/mailLinkify";
import HtmlMailFrame from "../components/mail/HtmlMailFrame";
import type { MailAccount, MailMessage, MailMessageFull, MailBody, MailFilter, MailFolder, MailConversation, MailAccountInput } from "../lib/mail";

// 共通のインラインSVGアイコン（絵文字は使わずモノクロSVGで統一）
const svg = (path: React.ReactNode, cls = "w-3.5 h-3.5") => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);
const IconSearch = (cls?: string) => svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>, cls);
const IconAttach = (cls = "w-3 h-3") => svg(<path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49" />, cls);
const IconPencil = (cls = "w-3 h-3") => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, cls);
const IconSync = (cls = "w-3.5 h-3.5") => svg(<><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></>, cls);

const IconPaperclip = (cls = "w-3.5 h-3.5") => svg(<path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49" />, cls);
const IconClose = (cls = "w-4 h-4") => svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, cls);

const MAIL_PAGE = 50;   // 一覧の1ページ件数（ページング）

// 添付ファイル（画面内で保持する形。base64 でAPIへ送る）
type LocalAttach = { name: string; type: string; size: number; b64: string };
// 作成中メールの状態（返信・転送・新規・下書き編集で共用）
type ComposeState = {
  mode: "reply" | "forward" | "draft" | "new";
  to: string; cc: string; bcc: string; showCcBcc: boolean;
  subject: string; text: string;
  replyToId?: number; attachments: LocalAttach[]; editingDraftId?: number;
  accountId?: number; pickAccount?: boolean;
};
const MAX_ATTACH_TOTAL = 10 * 1024 * 1024;   // 添付合計の上限（10MB）
const readFileB64 = (file: File): Promise<LocalAttach> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const b64 = s.includes(",") ? s.slice(s.indexOf(",") + 1) : s;   // data URL 接頭辞を除去
      resolve({ name: file.name, type: file.type || "application/octet-stream", size: file.size, b64 });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

// フォルダの用途アイコン（SPECIAL-USE → モノクロSVG）
const FolderIcon = ({ specialUse, className = "w-3.5 h-3.5" }: { specialUse: string; className?: string }) => {
  switch (specialUse) {
    case "\\Sent":    return svg(<path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />, className);
    case "\\Drafts":  return svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>, className);
    case "\\Trash":   return svg(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>, className);
    case "\\Junk":    return svg(<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>, className);
    case "\\Archive": return svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>, className);
    default:          return svg(<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />, className);
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
  const [signature, setSignature] = useState(editing?.signature ?? "");
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const input = (): MailAccountInput => ({
    id: editing?.id, address: address.trim(), label: label.trim(), host: host.trim(),
    port: Number(port) || 993, user: user.trim(), password: password || undefined, shared,
    smtpHost: smtpHost.trim(), smtpPort: Number(smtpPort) || 465, notes, signature,
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center md:items-center p-4" onClick={onClose}>
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
          <div>
            <label className="text-xs font-bold text-gray-600">署名</label>
            <textarea className={`${fieldCls} resize-y whitespace-pre-wrap`} rows={4} value={signature}
              onChange={(e) => setSignature(e.target.value)} placeholder="メール作成時に本文末尾へ自動挿入されます（会社名・連絡先など）" />
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
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl mb-3" style={{ background: "linear-gradient(90deg,#1e3a8a,#172554)" }}>
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
    // 大枠をウィンドウ高さに自動フィット。一覧だけ内部スクロール。
    <div className="h-[calc(100dvh-3rem)] flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-gray-100">
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

      <div className="flex-1 min-h-0 overflow-auto">
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
            <tr className="text-left text-[11px] text-gray-500 border-b border-gray-100 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-white">
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
                      <span className="text-amber-500 shrink-0 mt-0.5">{IconPencil()}</span><span className="line-clamp-3">{a.notes}</span>
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
  account, onBack, onCountsChanged, fill = false, accounts = [], initialComposeTo, onComposeConsumed,
}: {
  account: MailAccount; onBack?: () => void; onCountsChanged: () => void; fill?: boolean;
  accounts?: MailAccount[]; initialComposeTo?: string | null; onComposeConsumed?: () => void;
}) {
  const { members } = useMaster();
  const toast = useToast();
  const confirm = useConfirm();
  const acc = useAccountAccess();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selId, setSelId] = useState<number | null>(null);
  const [full, setFull] = useState<MailMessageFull | null>(null);
  const [body, setBody] = useState<MailBody | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyErr, setBodyErr] = useState<string>("");
  const [refetching, setRefetching] = useState(false);
  const [viewMode, setViewMode] = useState<"text" | "html">("text");   // 本文の表示形式（既定=テキスト）
  const [attachList, setAttachList] = useState<AttachmentMeta[] | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  // 取得済み本文のキャッシュ（同一セッション内は再取得しない）と、進行中の取得（Promiseを共有してレースを防ぐ）
  const bodyCache = useRef<Map<number, MailBody>>(new Map());
  const inflight = useRef<Map<number, Promise<MailBody>>>(new Map());
  const reqRef = useRef<number | null>(null);   // 最後に開こうとしたメールID（取得レースの取り違え防止）
  const [filter, setFilter] = useState<MailFilter>({ registeredOnly: false, folder: "INBOX" });
  const [q, setQ] = useState("");
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [pendingSend, setPendingSend] = useState<{ compose: ComposeState; sendId: number } | null>(null);   // 送信取消（Undo）用のバッファ
  const [undoLeft, setUndoLeft] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);   // 下書き自動保存の時刻
  const lastSavedRef = useRef<string>("");   // 直近に自動保存した内容のスナップショット
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templateMgrOpen, setTemplateMgrOpen] = useState(false);
  const [scheduledMgrOpen, setScheduledMgrOpen] = useState(false);

  const memberName = (id: number | null) =>
    id != null ? (members.find((m) => m.id === id)?.name ?? "") : "";
  // 宛先アドレス → 会員名（照合できなければ空）。送信箱の宛先名表示に使う。
  const recipientName = (email: string) => {
    const e = (email || "").toLowerCase();
    return e ? (members.find((m) => (m.email || "").toLowerCase() === e)?.name ?? "") : "";
  };

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await fetchMessages(account.id, { ...filter, q, limit: MAIL_PAGE, offset: 0 });
    setMessages(rows);
    setHasMore(rows.length === MAIL_PAGE);
    setLoading(false);
  }, [account.id, filter, q]);

  useEffect(() => { void load(); }, [load]);

  // ページング：現在の続きを追加読み込み
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchMessages(account.id, { ...filter, q, limit: MAIL_PAGE, offset: messages.length });
      setMessages((prev) => [...prev, ...rows]);
      setHasMore(rows.length === MAIL_PAGE);
    } finally { setLoadingMore(false); }
  };

  // フォルダ一覧を取得（IMAP経由）
  const loadFolders = useCallback(async () => {
    try { setFolders(await fetchFolders(account.id)); }
    catch { /* 取得失敗時はフォルダ列を出さない */ }
  }, [account.id]);
  useEffect(() => { void loadFolders(); }, [loadFolders]);

  // 定型文テンプレート
  const loadTemplates = useCallback(async () => {
    try { setTemplates(await listTemplates()); } catch { /* 取得失敗時は空のまま */ }
  }, []);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  // 受信トレイからの手動同期：サーバー(IMAP)から新着を取り込み、一覧・件数を更新
  const doSync = async () => {
    setSyncing(true);
    try {
      const results = await syncMail();
      const inserted = results.reduce((n, r) => n + r.inserted, 0);
      const failed = results.filter((r) => !r.ok);
      await load();
      await loadFolders();
      onCountsChanged();
      if (failed.length > 0) toast.error(`同期エラー：${failed.map((f) => f.address).join(", ")}`);
      else toast.success(inserted > 0 ? `新着 ${inserted} 件を取り込みました` : "新着はありませんでした");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setSyncing(false);
    }
  };

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
  //   進行中の取得は同じ Promise を共有する（先読み中にクリックしても null を返さず、必ず結果を待てる）。
  //   force=true はキャッシュ（メモリ＋DB）を無視して再取得する。
  const loadBody = useCallback((id: number, force = false): Promise<MailBody> => {
    if (!force) {
      const cached = bodyCache.current.get(id);
      if (cached) return Promise.resolve(cached);
      const running = inflight.current.get(id);
      if (running) return running;
    }
    const p = fetchBody(id, force)
      .then((b) => { bodyCache.current.set(id, b); return b; })
      .finally(() => { inflight.current.delete(id); });
    inflight.current.set(id, p);
    return p;
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
    setViewMode("text");   // 開くたびに安全な既定（テキスト）へ戻す
    setAttachList(null);   // 添付一覧は開くたびリセット（必要時にオンデマンド取得）
    setFull(await fetchMessage(m.id));
    // キャッシュ（先読み含む）があれば即表示。無ければ取得する。
    const cached = bodyCache.current.get(m.id);
    if (cached) {
      setBody(cached); setBodyLoading(false);
    } else {
      setBody(null); setBodyLoading(true);
      try {
        const b = await loadBody(m.id);   // 進行中なら同じPromiseを待つ（レースで失敗表示にならない）
        if (reqRef.current === m.id) setBody(b);
      } catch (e: unknown) {
        // 実際のサーバーエラーをそのまま表示（汎用文言で隠さない）
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

  // 添付一覧をオンデマンドで取得（IMAPから）
  const loadAttachments = async () => {
    if (!full) return;
    setAttachLoading(true);
    try { setAttachList(await listAttachments(full.id)); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "添付一覧の取得に失敗しました"); }
    finally { setAttachLoading(false); }
  };
  // 添付1件をダウンロード（base64 → Blob）
  const doDownloadAttachment = async (index: number, filename: string) => {
    if (!full) return;
    try {
      const f = await downloadAttachment(full.id, index);
      const bin = atob(f.contentBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
      const a = document.createElement("a");
      a.href = url; a.download = f.filename || filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "ダウンロードに失敗しました"); }
  };

  // 本文を再取得（キャッシュ無視でIMAP直取得）。エラー時に手動でやり直す。
  const doRefetch = async () => {
    if (!full) return;
    const id = full.id;
    setRefetching(true); setBodyErr("");
    try {
      bodyCache.current.delete(id);
      const b = await loadBody(id, true);
      if (reqRef.current === id) setBody(b);
    } catch (e: unknown) {
      if (reqRef.current === id) setBodyErr(e instanceof Error ? e.message : "本文の取得に失敗しました");
    } finally {
      setRefetching(false);
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

  // 署名ブロック（本文末尾へ自動挿入）。表示中アカウントの署名を使う。
  const sigBlock = () => {
    const s = (account.signature ?? "").trim();
    return s ? `\n\n-- \n${s}` : "";
  };
  const blank = { cc: "", bcc: "", showCcBcc: false };

  // 新規作成（Mailboxのボタン）：白紙で開く。差出は表示中アカウント固定。
  const openNew = () => {
    setCompose({ mode: "new", to: "", ...blank, subject: "", text: sigBlock(), attachments: [], accountId: account.id });
  };
  // 顧客詳細からの遷移（?compose=メール）：宛先を入れ、差出は毎回選ばせる（署名は差出選択時に挿入）
  useEffect(() => {
    const to = (initialComposeTo ?? "").trim();
    if (!to) return;
    setCompose({ mode: "new", to, ...blank, subject: "", text: "", attachments: [], pickAccount: true });
    onComposeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialComposeTo]);

  // 返信・転送・下書き編集
  const openReply = () => {
    if (!full) return;
    setCompose({ mode: "reply", to: full.fromAddr, ...blank, subject: /^\s*re:/i.test(full.subject) ? full.subject : `Re: ${full.subject}`, text: sigBlock(), replyToId: full.id, attachments: [], accountId: account.id });
  };
  // 全員に返信：差出人を To、元の宛先（自分と差出人を除く）を Cc に入れる
  const openReplyAll = () => {
    if (!full) return;
    const self = (account.address || "").toLowerCase();
    const from = (full.fromAddr || "").toLowerCase();
    const others = (full.toAddr.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? [])
      .filter((a) => { const l = a.toLowerCase(); return l !== self && l !== from; });
    setCompose({
      mode: "reply", to: full.fromAddr, cc: others.join(", "), bcc: "", showCcBcc: others.length > 0,
      subject: /^\s*re:/i.test(full.subject) ? full.subject : `Re: ${full.subject}`,
      text: sigBlock(), replyToId: full.id, attachments: [], accountId: account.id,
    });
  };
  const openForward = () => {
    if (!full) return;
    const quoted = body?.bodyText ? `\n\n--- 転送メッセージ ---\n${body.bodyText}` : "";
    setCompose({ mode: "forward", to: "", ...blank, subject: /^\s*fwd?:/i.test(full.subject) ? full.subject : `Fwd: ${full.subject}`, text: `${sigBlock()}${quoted}`, attachments: [], accountId: account.id });
  };
  // Drafts の下書きを開いて続きを編集（保存時に旧下書きを置き換える）
  const openDraftEdit = () => {
    if (!full) return;
    setCompose({ mode: "draft", to: full.toAddr || "", ...blank, subject: full.subject || "", text: body?.bodyText ?? "", attachments: [], editingDraftId: full.id, accountId: account.id });
  };

  const toAtt = (list: LocalAttach[]): MailAttachment[] =>
    list.map((a) => ({ filename: a.name, contentBase64: a.b64, contentType: a.type }));

  // 実際に送信/保存に使う差出アカウント（毎回選ばせるモードでは compose.accountId、通常は表示中）
  const composeAccountId = (): number | null => compose?.accountId ?? account.id ?? null;
  // 差出候補（SMTP設定あり＆送信権限あり）。毎回選ばせる（②）ときの選択肢。
  const sendableAccounts = accounts.filter((a) => a.smtpHost && acc.canOperate("mailbox", "mail", a.id));

  const clearUndo = () => {
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    if (undoInterval.current) { clearInterval(undoInterval.current); undoInterval.current = null; }
  };
  // 実際の送信（Undo猶予が過ぎたら実行）
  const actuallySend = async (c: ComposeState, sendId: number) => {
    clearUndo();
    setPendingSend(null);
    setSending(true);
    try {
      await sendMail({ accountId: sendId, to: c.to.trim(), cc: c.cc.trim(), bcc: c.bcc.trim(), subject: c.subject, text: c.text, replyToId: c.replyToId, attachments: toAtt(c.attachments) });
      if (c.editingDraftId != null) await deleteMailMessage(c.editingDraftId).catch(() => {});
      lastSavedRef.current = "";
      toast.success("送信しました");
      void load();
      void loadFolders();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
      setCompose(c);   // 失敗時は作成画面へ戻す
    } finally { setSending(false); }
  };
  // 送信ボタン：すぐには送らず、数秒の「取消」猶予を置く
  const doSend = () => {
    if (!compose || !compose.to.trim() || !compose.text.trim()) { toast.error("宛先と本文を入力してください"); return; }
    const sendId = composeAccountId();
    if (sendId == null) { toast.error("差出アカウントを選択してください"); return; }
    if (!acc.canOperate("mailbox", "mail", sendId)) { toast.error("このアカウントは閲覧のみ（送信権限がありません）"); return; }
    const snapshot = compose;
    setPendingSend({ compose: snapshot, sendId });
    setUndoLeft(5);
    setCompose(null);
    clearUndo();
    undoInterval.current = setInterval(() => setUndoLeft((s) => Math.max(0, s - 1)), 1000);
    undoTimer.current = setTimeout(() => { void actuallySend(snapshot, sendId); }, 5000);
  };
  // 送信取消：作成画面へ戻す
  const cancelSend = () => {
    clearUndo();
    const c = pendingSend?.compose ?? null;
    setPendingSend(null);
    if (c) setCompose(c);
  };
  useEffect(() => () => clearUndo(), []);   // アンマウント時にタイマー掃除

  // 送信予約：指定日時に送るようキューへ登録する
  const doSchedule = async (scheduledAtISO: string) => {
    if (!compose || !compose.to.trim() || !compose.text.trim()) { toast.error("宛先と本文を入力してください"); return; }
    const sendId = composeAccountId();
    if (sendId == null) { toast.error("差出アカウントを選択してください"); return; }
    if (!acc.canOperate("mailbox", "mail", sendId)) { toast.error("このアカウントは閲覧のみ（送信権限がありません）"); return; }
    const c = compose;
    try {
      await scheduleMail({ accountId: sendId, to: c.to.trim(), cc: c.cc.trim(), bcc: c.bcc.trim(), subject: c.subject, text: c.text, replyToId: c.replyToId, attachments: toAtt(c.attachments), scheduledAt: scheduledAtISO });
      if (c.editingDraftId != null) await deleteMailMessage(c.editingDraftId).catch(() => {});
      lastSavedRef.current = "";
      toast.success("送信を予約しました");
      setCompose(null);
      void loadFolders();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "予約に失敗しました");
    }
  };
  const doSaveDraft = async () => {
    if (!compose) return;
    if (!compose.text.trim() && !compose.subject.trim() && compose.attachments.length === 0) { toast.error("下書きに保存する内容がありません"); return; }
    const sendId = composeAccountId();
    if (sendId == null) { toast.error("差出アカウントを選択してください"); return; }
    if (!acc.canOperate("mailbox", "mail", sendId)) { toast.error("このアカウントは閲覧のみ（送信権限がありません）"); return; }
    setSavingDraft(true);
    try {
      await saveDraft({ accountId: sendId, to: compose.to.trim(), cc: compose.cc.trim(), bcc: compose.bcc.trim(), subject: compose.subject, text: compose.text, replyToId: compose.replyToId, attachments: toAtt(compose.attachments), replaceMessageId: compose.editingDraftId });
      lastSavedRef.current = "";
      toast.success("下書きに保存しました");
      setCompose(null);
      void load();
      void loadFolders();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "下書きの保存に失敗しました");
    } finally { setSavingDraft(false); }
  };

  // 下書きの自動保存：入力停止から数秒後に、差出が決まっていて内容があるときだけ保存する。
  //   作成された下書きIDを editingDraftId に持ち、次回はそれを置き換える（重複を残さない）。
  useEffect(() => {
    if (!compose) { lastSavedRef.current = ""; setAutoSavedAt(null); return; }
    const sendId = compose.accountId ?? account.id;
    if (sendId == null) return;
    const hasContent = !!(compose.text.trim() || compose.subject.trim() || compose.to.trim() || compose.attachments.length);
    if (!hasContent) return;
    const snap = JSON.stringify({
      to: compose.to, cc: compose.cc, bcc: compose.bcc, subject: compose.subject,
      text: compose.text, a: compose.attachments.map((x) => `${x.name}:${x.size}`),
    });
    if (snap === lastSavedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const newId = await saveDraft({
          accountId: sendId, to: compose.to.trim(), cc: compose.cc.trim(), bcc: compose.bcc.trim(),
          subject: compose.subject, text: compose.text, replyToId: compose.replyToId,
          attachments: toAtt(compose.attachments), replaceMessageId: compose.editingDraftId,
        });
        lastSavedRef.current = snap;
        setAutoSavedAt(new Date());
        if (newId) setCompose((c) => (c ? { ...c, editingDraftId: newId } : c));
      } catch { /* 自動保存の失敗は黙って無視（手動保存で対処できる） */ }
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose?.to, compose?.cc, compose?.bcc, compose?.subject, compose?.text, compose?.attachments, compose?.accountId]);

  const setF = (patch: Partial<MailFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const curPath = filter.folder ?? "INBOX";
  const curFolder = folders.find((f) => f.path === curPath);
  const curTitle = curFolder ? folderLabel(curFolder) : "受信トレイ";
  const isDraftsFolder = curFolder?.specialUse === "\\Drafts" || /draft|下書き/i.test(curFolder?.path ?? "");

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col min-h-[520px] ${fill ? "h-full" : "h-[calc(100dvh-3rem)]"}`}>
      {/* ヘッダ */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        {onBack && <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">← 一覧</button>}
        <div>
          <h1 className="text-base font-extrabold leading-tight">{curTitle}</h1>
          <p className="text-[11px] text-gray-500">{account.address}</p>
        </div>
        {account.smtpHost && acc.canOperate("mailbox", "mail", account.id) && (
          <button onClick={openNew}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 bg-red-600 text-white hover:bg-red-700"
            title="新しいメッセージを作成します">
            {IconPencil("w-3.5 h-3.5")} 新規作成
          </button>
        )}
        {account.smtpHost && acc.canOperate("mailbox", "mail", account.id) && (
          <button onClick={() => setScheduledMgrOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="送信予約の一覧">予約一覧</button>
        )}
        <button onClick={doSync} disabled={syncing}
          className={`${account.smtpHost && acc.canOperate("mailbox", "mail", account.id) ? "" : "ml-auto"} inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed`}
          title="サーバーから新着メールを取り込みます">
          <span className={syncing ? "animate-spin" : ""}>{IconSync()}</span>
          {syncing ? "同期中…" : "受信同期"}
        </button>
      </div>
      {/* ツールバー */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[340px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">{IconSearch("w-3.5 h-3.5")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="メールを検索"
            className="w-full bg-gray-100 border border-gray-200 rounded-lg h-8 pl-8 pr-3 text-xs focus:outline-none focus:border-blue-300" />
        </div>
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
                  <span className="shrink-0"><FolderIcon specialUse={f.specialUse} /></span>
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
          ) : messages.map((m) => {
            // 送信系（Sent/Drafts＝out）は「差出＝自分」ではなく宛先を主表示にする
            const outbound = m.direction === "out";
            const toName = outbound ? recipientName(m.counterpart) : "";
            const primary = outbound ? (toName || m.counterpart || "（宛先なし）") : (m.fromName || m.fromAddr);
            return (
            <div key={m.id} onClick={() => open(m)} onMouseEnter={() => prefetch(m)}
              className={`flex gap-2.5 px-4 py-3 border-b border-gray-100 cursor-pointer ${selId === m.id ? "bg-blue-50 shadow-[inset_3px_0_0_#2563eb]" : "hover:bg-slate-50"}`}>
              <div className="flex flex-col items-center gap-2 pt-0.5">
                <button onClick={(e) => toggleStar(m, e)} className={`text-[15px] leading-none ${m.isStarred ? "text-amber-500" : "text-gray-300 hover:text-gray-400"}`}>★</button>
                <button onClick={(e) => toggleFlag(m, e)} className={`text-[13px] leading-none ${m.isFlagged ? "text-red-600" : "text-gray-300 hover:text-gray-400"}`}>⚑</button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {!m.isRead && <span className="w-[7px] h-[7px] rounded-full bg-blue-500 shrink-0" />}
                  {outbound && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 shrink-0">To</span>}
                  <span className={`text-[13px] truncate max-w-[160px] ${m.isRead ? "font-semibold text-gray-600" : "font-extrabold text-gray-900"}`}>
                    {primary}
                  </span>
                  {m.isMember && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">会員</span>}
                  <span className="ml-auto text-[11px] text-gray-400 shrink-0">{fmt(m.receivedAt)}</span>
                </div>
                {outbound && toName && <div className="text-[10.5px] text-gray-400 truncate">{m.counterpart}</div>}
                <div className={`text-[12.5px] mt-0.5 truncate ${m.isRead ? "font-semibold text-gray-600" : "font-bold text-gray-900"}`}>{m.subject || "（件名なし）"}</div>
                {m.hasAttach && <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">{IconAttach()} 添付あり</div>}
              </div>
            </div>
            );
          })}
          {!loading && hasMore && (
            <div className="p-3 text-center">
              <button onClick={loadMore} disabled={loadingMore}
                className="text-xs font-bold rounded-lg px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">
                {loadingMore ? "読み込み中…" : "さらに読み込む"}
              </button>
            </div>
          )}
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
                  {(() => {
                    const outbound = full.direction === "out";
                    const toAddr = full.toAddr || full.counterpart;
                    const primaryName = outbound ? (recipientName(toAddr) || toAddr) : (full.fromName || full.fromAddr);
                    return (
                      <>
                        <span className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 grid place-items-center font-bold">{initial(primaryName)}</span>
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-extrabold flex items-center gap-2">
                            {outbound && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700">To</span>}
                            {primaryName}
                            {full.isMember && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                会員{memberName(full.memberId) ? `・${memberName(full.memberId)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">{outbound ? toAddr : full.fromAddr}</div>
                          {outbound && <div className="text-[10.5px] text-gray-400 truncate">差出: {full.fromAddr}</div>}
                        </div>
                      </>
                    );
                  })()}
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
              <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-gray-800">
                {/* テキスト/HTML 切替（HTMLメールのときのみ） */}
                {!bodyLoading && !bodyErr && body?.bodyHtml && (
                  <div className="mb-3 inline-flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-bold">
                    <button onClick={() => setViewMode("text")}
                      className={viewMode === "text" ? "px-3 py-1 bg-blue-900 text-white" : "px-3 py-1 bg-white text-gray-600"}>テキスト</button>
                    <button onClick={() => setViewMode("html")}
                      className={viewMode === "html" ? "px-3 py-1 bg-blue-900 text-white" : "px-3 py-1 bg-white text-gray-600"}>HTML</button>
                  </div>
                )}
                {bodyLoading ? (
                  <span className="text-gray-400">本文を読み込み中…</span>
                ) : bodyErr ? (
                  <div>
                    <p className="text-red-500 whitespace-pre-wrap break-words">{bodyErr}</p>
                    <button onClick={doRefetch} disabled={refetching}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60">
                      <span className={refetching ? "animate-spin" : ""}>{IconSync("w-3.5 h-3.5")}</span>
                      {refetching ? "取得中…" : "本文を再取得"}
                    </button>
                  </div>
                ) : body?.bodyHtml && viewMode === "html" ? (
                  <HtmlMailFrame html={body.bodyHtml} />
                ) : body?.bodyText?.trim() ? (
                  <div className="whitespace-pre-wrap break-words">{linkify(body.bodyText)}</div>
                ) : body?.bodyHtml ? (
                  <div className="whitespace-pre-wrap break-words text-gray-400">（HTML形式のメールです。上の「HTML」で表示できます）</div>
                ) : (
                  <span className="text-gray-400">（本文がありません）</span>
                )}
              </div>
              {/* 添付ファイル（オンデマンド取得＋ダウンロード） */}
              {(body?.hasAttach ?? full.hasAttach) && (
                <div className="border-t border-gray-100 px-5 py-3 bg-white">
                  {attachList == null ? (
                    <button onClick={loadAttachments} disabled={attachLoading}
                      className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                      {IconAttach()} {attachLoading ? "読み込み中…" : "添付ファイルを表示"}
                    </button>
                  ) : attachList.length === 0 ? (
                    <span className="text-[11px] text-gray-400">添付ファイルはありません</span>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-gray-500">添付ファイル（{attachList.length}）</div>
                      <div className="flex flex-wrap gap-2">
                        {attachList.map((a) => (
                          <button key={a.index} onClick={() => doDownloadAttachment(a.index, a.filename)}
                            className="inline-flex items-center gap-1.5 text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-100"
                            title="クリックでダウンロード">
                            <span className="text-gray-400">{IconAttach("w-3 h-3")}</span>
                            <span className="max-w-[200px] truncate">{a.filename}</span>
                            <span className="text-gray-400">{fmtBytes(a.size)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50 flex items-center gap-2">
                {account.smtpHost ? (
                  isDraftsFolder ? (
                    <button onClick={openDraftEdit} className="text-sm font-bold rounded-lg px-3.5 py-1.5 bg-blue-700 text-white hover:bg-blue-800">下書きを編集</button>
                  ) : (
                    <>
                      <button onClick={openReply} className="text-sm font-bold rounded-lg px-3.5 py-1.5 bg-red-600 text-white hover:bg-red-700">返信</button>
                      <button onClick={openReplyAll} className="text-sm font-bold rounded-lg px-3.5 py-1.5 border border-gray-200 hover:bg-white">全員に返信</button>
                      <button onClick={openForward} className="text-sm font-bold rounded-lg px-3.5 py-1.5 border border-gray-200 hover:bg-white">転送</button>
                    </>
                  )
                ) : (
                  <span className="text-[11px] text-gray-400">送信するには、アカウント編集で SMTP ホストを設定してください。</span>
                )}
                {(body?.hasAttach ?? full.hasAttach) ? <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400">{IconAttach()} 添付あり</span> : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {compose && (
        <ComposeModal
          compose={compose}
          setCompose={(c) => setCompose(c)}
          accounts={sendableAccounts}
          templates={templates}
          onManageTemplates={() => setTemplateMgrOpen(true)}
          sending={sending}
          savingDraft={savingDraft}
          autoSavedAt={autoSavedAt}
          onSend={doSend}
          onSaveDraft={doSaveDraft}
          onSchedule={doSchedule}
          onClose={() => setCompose(null)}
        />
      )}

      {templateMgrOpen && (
        <TemplateManager templates={templates} onClose={() => setTemplateMgrOpen(false)} onChanged={loadTemplates} />
      )}
      {scheduledMgrOpen && (
        <ScheduledManager onClose={() => setScheduledMgrOpen(false)} />
      )}

      {/* 送信取消バナー（数秒間） */}
      {pendingSend && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-gray-900 text-white rounded-xl px-4 py-2.5 shadow-2xl text-sm">
          <span>メールを送信します…（{undoLeft}）</span>
          <button onClick={cancelSend} className="font-bold text-blue-300 hover:text-blue-200">取消</button>
        </div>
      )}
    </div>
  );
}

// ── 返信・下書きの編集モーダル（大きな別画面風）──────────────
function ComposeModal({
  compose, setCompose, accounts, templates, onManageTemplates, sending, savingDraft, autoSavedAt, onSend, onSaveDraft, onSchedule, onClose,
}: {
  compose: ComposeState;
  setCompose: (c: ComposeState) => void;
  accounts: MailAccount[];
  templates: MailTemplate[];
  onManageTemplates: () => void;
  sending: boolean; savingDraft: boolean; autoSavedAt: Date | null;
  onSend: () => void; onSaveDraft: () => void; onSchedule: (iso: string) => void; onClose: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedAt, setSchedAt] = useState("");
  const title = compose.mode === "forward" ? "メールを転送" : compose.mode === "draft" ? "下書きを編集" : compose.mode === "new" ? "新規メール" : "メールに返信";
  const totalSize = compose.attachments.reduce((n, a) => n + a.size, 0);
  const busy = sending || savingDraft;

  // 定型文を挿入：本文の先頭に本文を入れ、件名が空なら件名も入れる（署名は末尾に維持）
  const applyTemplate = (id: number) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setCompose({
      ...compose,
      subject: compose.subject.trim() ? compose.subject : t.subject,
      text: t.body + (compose.text ? (compose.text.startsWith("\n") ? "" : "\n") + compose.text : ""),
    });
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked: LocalAttach[] = [];
    for (const f of Array.from(files)) picked.push(await readFileB64(f));
    const next = [...compose.attachments, ...picked];
    const sum = next.reduce((n, a) => n + a.size, 0);
    if (sum > MAX_ATTACH_TOTAL) { toast.error(`添付の合計が上限（${fmtBytes(MAX_ATTACH_TOTAL)}）を超えます`); return; }
    setCompose({ ...compose, attachments: next });
    if (fileRef.current) fileRef.current.value = "";
  };
  const removeAttach = (i: number) =>
    setCompose({ ...compose, attachments: compose.attachments.filter((_, idx) => idx !== i) });

  // 差出アカウント選択時：署名が未挿入なら、そのアカウントの署名を本文末尾へ入れる
  const onAccountChange = (idStr: string) => {
    const id = idStr ? Number(idStr) : undefined;
    const sig = (accounts.find((a) => a.id === id)?.signature ?? "").trim();
    let text = compose.text;
    if (sig && !text.includes("\n-- \n")) text = `${text}\n\n-- \n${sig}`;
    setCompose({ ...compose, accountId: id, text });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end justify-items-center md:place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* ヘッダ */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-base font-extrabold">{title}</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700" title="閉じる">{IconClose()}</button>
        </div>
        {/* 本体 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {compose.pickAccount && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-500 w-12 shrink-0">差出</span>
              <select value={compose.accountId ?? ""} onChange={(e) => onAccountChange(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400">
                <option value="">差出アカウントを選択してください</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.displayName ? `${a.displayName}（${a.address}）` : a.address}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-500 w-12 shrink-0">宛先</span>
            <input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" placeholder="送信先メールアドレス" />
            {!compose.showCcBcc && (
              <button onClick={() => setCompose({ ...compose, showCcBcc: true })}
                className="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-800">Cc/Bcc</button>
            )}
          </div>
          {compose.showCcBcc && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-500 w-12 shrink-0">Cc</span>
                <input value={compose.cc} onChange={(e) => setCompose({ ...compose, cc: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" placeholder="カンマ区切りで複数指定できます" />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-500 w-12 shrink-0">Bcc</span>
                <input value={compose.bcc} onChange={(e) => setCompose({ ...compose, bcc: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" placeholder="Bcc は他の受信者に表示されません" />
              </div>
            </>
          )}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-500 w-12 shrink-0">件名</span>
            <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" placeholder="件名" />
          </div>
          {/* 定型文テンプレート */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500 w-12 shrink-0">定型文</span>
            <select value="" onChange={(e) => { if (e.target.value) applyTemplate(Number(e.target.value)); e.currentTarget.value = ""; }}
              disabled={templates.length === 0}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 disabled:text-gray-400 max-w-[260px]">
              <option value="">{templates.length ? "テンプレートを挿入…" : "テンプレート未登録"}</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={onManageTemplates} className="text-xs font-bold text-blue-600 hover:text-blue-800">管理</button>
          </div>
          <textarea value={compose.text} onChange={(e) => setCompose({ ...compose, text: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-y focus:outline-none focus:border-blue-400 min-h-[280px]" placeholder="本文" />
          {/* 添付 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50">
                {IconPaperclip()} ファイルを添付
              </button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onPickFiles(e.target.files)} />
              {compose.attachments.length > 0 && (
                <span className="text-[11px] text-gray-400">計 {compose.attachments.length} 件・{fmtBytes(totalSize)}（上限 {fmtBytes(MAX_ATTACH_TOTAL)}）</span>
              )}
            </div>
            {compose.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {compose.attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-[11px] bg-gray-100 border border-gray-200 rounded-lg pl-2 pr-1 py-1">
                    <span className="text-gray-400">{IconPaperclip("w-3 h-3")}</span>
                    <span className="max-w-[180px] truncate">{a.name}</span>
                    <span className="text-gray-400">{fmtBytes(a.size)}</span>
                    <button onClick={() => removeAttach(i)} className="text-gray-400 hover:text-red-500" title="削除">{IconClose("w-3.5 h-3.5")}</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* 送信予約（開いたとき） */}
        {schedOpen && (
          <div className="flex items-center gap-2 px-5 py-2.5 border-t border-gray-100 bg-blue-50/50">
            <span className="text-xs font-bold text-gray-600">送信日時</span>
            <input type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400" />
            <button onClick={() => { if (!schedAt) { toast.error("日時を選択してください"); return; } onSchedule(new Date(schedAt).toISOString()); }} disabled={busy}
              className="text-xs font-bold rounded-lg px-3 py-1.5 bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50">この日時で予約</button>
            <button onClick={() => setSchedOpen(false)} className="text-xs font-bold text-gray-500 hover:text-gray-700">閉じる</button>
          </div>
        )}
        {/* フッタ */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100">
          <button onClick={onClose} disabled={busy}
            className="text-sm font-bold rounded-lg px-4 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
          {autoSavedAt && (
            <span className="text-[11px] text-gray-400">自動保存 {autoSavedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          <button onClick={() => setSchedOpen((v) => !v)} disabled={busy}
            className="ml-auto text-sm font-bold rounded-lg px-3 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">予約</button>
          <button onClick={onSaveDraft} disabled={busy}
            className="text-sm font-bold rounded-lg px-4 py-2 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50">
            {savingDraft ? "保存中…" : "下書き保存"}</button>
          <button onClick={onSend} disabled={busy}
            className="text-sm font-bold rounded-lg px-5 py-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {sending ? "送信中…" : "送信"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 定型文テンプレートの管理（一覧・追加・編集・削除）─────────
function TemplateManager({
  templates, onClose, onChanged,
}: {
  templates: MailTemplate[]; onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<MailTemplate[]>(templates);
  const [editing, setEditing] = useState<{ id?: number; name: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => { setList(await listTemplates()); await onChanged(); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("テンプレート名を入力してください"); return; }
    setBusy(true);
    try {
      await saveTemplate({ id: editing.id, name: editing.name.trim(), subject: editing.subject, body: editing.body });
      setEditing(null); await reload(); toast.success("保存しました");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "保存に失敗しました"); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    if (!(await confirm({ title: "テンプレート削除", message: "この定型文を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    try { await deleteTemplate(id); await reload(); toast.success("削除しました"); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "削除に失敗しました"); }
  };

  const fieldCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400";

  return (
    <div className="fixed inset-0 z-[55] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-base font-extrabold">定型文の管理</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700" title="閉じる">{IconClose()}</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-600">テンプレート名</label>
                <input className={fieldCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例：ウェビナー御礼" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600">件名（任意）</label>
                <input className={fieldCls} value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="件名が空のとき、この値が入ります" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600">本文</label>
                <textarea className={`${fieldCls} resize-y min-h-[180px] whitespace-pre-wrap`} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder="定型の本文（改行可）" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="text-sm font-bold rounded-lg px-4 py-2 border border-gray-200 hover:bg-gray-50">戻る</button>
                <button onClick={save} disabled={busy} className="ml-auto text-sm font-bold rounded-lg px-5 py-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{busy ? "保存中…" : "保存"}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button onClick={() => setEditing({ name: "", subject: "", body: "" })}
                className="text-xs font-bold text-blue-600 hover:text-blue-800">＋ 新しい定型文</button>
              {list.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">定型文がありません。「＋ 新しい定型文」で追加できます。</div>
              ) : list.map((t) => (
                <div key={t.id} className="flex items-start gap-2 border border-gray-100 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate">{t.name}</div>
                    {t.subject && <div className="text-[11px] text-gray-500 truncate">件名: {t.subject}</div>}
                    <div className="text-[11px] text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.body}</div>
                  </div>
                  <button onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0">編集</button>
                  <button onClick={() => remove(t.id)} className="text-xs font-bold text-red-500 hover:text-red-700 shrink-0">削除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 送信予約の一覧（取消）────────────────────────────────────
function ScheduledManager({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<ScheduledMail[] | null>(null);

  const reload = async () => {
    try { setList(await listScheduled()); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "予約一覧の取得に失敗しました"); setList([]); }
  };
  useEffect(() => { void reload(); }, []);

  const cancel = async (id: number) => {
    if (!(await confirm({ title: "予約の取消", message: "この予約送信を取り消しますか？", confirmLabel: "取り消す", danger: true }))) return;
    try { await cancelScheduled(id); toast.success("予約を取り消しました"); await reload(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "取消に失敗しました"); }
  };
  const fmtDt = (s: string) => new Date(s).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-[55] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-base font-extrabold">送信予約の一覧</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700" title="閉じる">{IconClose()}</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2">
          {list == null ? (
            <div className="text-sm text-gray-400 py-8 text-center">読み込み中…</div>
          ) : list.length === 0 ? (
            <div className="text-sm text-gray-400 py-8 text-center">予約中のメールはありません。</div>
          ) : list.map((s) => (
            <div key={s.id} className="flex items-start gap-2 border border-gray-100 rounded-lg px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-blue-700">{fmtDt(s.scheduledAt)} 送信予定</div>
                <div className="text-sm font-bold truncate">{s.subject || "（件名なし）"}</div>
                <div className="text-[11px] text-gray-500 truncate">To: {s.to}{s.cc ? `　Cc: ${s.cc}` : ""}</div>
              </div>
              <button onClick={() => cancel(s.id)} className="text-xs font-bold text-red-500 hover:text-red-700 shrink-0">取消</button>
            </div>
          ))}
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
    return <Inbox account={sel} onBack={() => setSel(null)} onCountsChanged={reloadAccounts} accounts={accounts} />;
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
  const route = useRoute();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  // 顧客詳細から「?compose=メールアドレス」で遷移してきたら、新規作成を自動で開く
  const [composeTo, setComposeTo] = useState<string | null>(() => route.q("compose"));

  const reload = useCallback(async () => {
    const list = await fetchAccounts();
    setAccounts(list);
    setSelId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => { (async () => { await reload(); setLoading(false); })(); }, [reload]);

  // アカウント単位権限：閲覧できるメールアカウントのみ（読込前は全表示）
  const acc = useAccountAccess();
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !acc.loaded || acc.canSee("mailbox", "mail", a.id)),
    [accounts, acc]
  );

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

  const sel = visibleAccounts.find((a) => a.id === selId) ?? visibleAccounts[0];
  if (!sel) {
    return <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-500 text-sm">閲覧できるメールアカウントがありません（権限設定をご確認ください）。</div>;
  }
  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)] min-w-0">
      <div className="shrink-0">
        <MailAccountBar accounts={visibleAccounts} accountId={sel.id} onSelect={setSelId} screenLabel="受信トレイ" />
      </div>
      <div className="flex-1 min-h-0">
        <Inbox account={sel} onCountsChanged={reload} fill accounts={visibleAccounts}
          initialComposeTo={composeTo}
          onComposeConsumed={() => { setComposeTo(null); route.setQuery({ compose: null }); }} />
      </div>
    </div>
  );
}

// ── 会話（送受信一貫）本体 ──────────────────────────────────
function Conversations({ account }: { account: MailAccount }) {
  const { members } = useMaster();
  const toast = useToast();
  const acc = useAccountAccess();
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
    if (!acc.canOperate("mailbox", "mail", account.id)) { toast.error("このアカウントは閲覧のみ（送信権限がありません）"); return; }
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
                        {m.hasAttach && <span className="inline-flex">{IconAttach()}</span>}
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
