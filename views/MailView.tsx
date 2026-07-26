"use client";
// ============================================================
// メール（Phase 1・受信）  view = "mail"（運営のみ）
//   ・アカウント未選択 … メールアドレス一覧（接続状態・未読・フラグ件数）
//   ・アカウント選択中 … 受信ボックス（左：一覧／右：確認ペイン）
//   機能：受信同期／「登録メアドのみ」フィルタ／スター・フラグ・既読
//   ⚠️ 受信本文は body_text をそのまま表示する（HTMLメールの生描画はXSSと
//      外部画像トラッキングの温床になるため Phase 1 では行わない）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import { fmtJst } from "../lib/dateFmt";
import {
  fetchAccounts, fetchMessages, fetchMessage, fetchBody,
  markRead, setStarred, setFlagged, syncMail,
  saveAccount, deleteAccount, testAccount,
} from "../lib/mail";
import type { MailAccount, MailMessage, MailMessageFull, MailBody, MailFilter, MailAccountInput } from "../lib/mail";

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
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const input = (): MailAccountInput => ({
    id: editing?.id, address: address.trim(), label: label.trim(), host: host.trim(),
    port: Number(port) || 993, user: user.trim(), password: password || undefined, shared,
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
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [full, setFull] = useState<MailMessageFull | null>(null);
  const [body, setBody] = useState<MailBody | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyErr, setBodyErr] = useState<string>("");
  const [filter, setFilter] = useState<MailFilter>({ registeredOnly: false });
  const [q, setQ] = useState("");

  const memberName = (id: number | null) =>
    id != null ? (members.find((m) => m.id === id)?.name ?? "") : "";

  const load = useCallback(async () => {
    setLoading(true);
    setMessages(await fetchMessages(account.id, { ...filter, q }));
    setLoading(false);
  }, [account.id, filter, q]);

  useEffect(() => { void load(); }, [load]);

  const open = async (m: MailMessage) => {
    setSelId(m.id);
    setBody(null); setBodyErr("");
    setFull(await fetchMessage(m.id));
    // 本文はDBに無いので、開いた瞬間に IMAP から都度取得する（ハイブリッド型）
    setBodyLoading(true);
    try {
      const b = await fetchBody(m.id);
      setBody(b);
    } catch (e: unknown) {
      setBodyErr(e instanceof Error ? e.message : "本文の取得に失敗しました");
    } finally {
      setBodyLoading(false);
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

  const setF = (patch: Partial<MailFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col h-[72vh] min-h-[520px]">
      {/* ヘッダ */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        {onBack && <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">← 一覧</button>}
        <div>
          <h1 className="text-base font-extrabold leading-tight">受信トレイ</h1>
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
        {/* メール一覧 */}
        <div className="w-[46%] min-w-[300px] border-r border-gray-100 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">読み込み中…</div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">該当するメールはありません</div>
          ) : messages.map((m) => (
            <div key={m.id} onClick={() => open(m)}
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
              <div className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-400 bg-gray-50">
                返信・転送は Phase 3 で対応予定です。{(body?.hasAttach ?? full.hasAttach) && "　📎 添付あり"}
              </div>
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
      {accounts.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setSelId(a.id)}
              className={`text-xs font-bold rounded-lg px-3 py-1.5 border transition-colors ${sel.id === a.id ? "bg-blue-100 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
              {a.address}{a.unread > 0 ? ` (${a.unread})` : ""}
            </button>
          ))}
        </div>
      )}
      <Inbox account={sel} onCountsChanged={reload} />
    </div>
  );
}
