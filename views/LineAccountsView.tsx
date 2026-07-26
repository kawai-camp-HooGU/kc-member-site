"use client";
// LINEアカウント（運営）：公式LINEアカウントの 追加/確認/削除/接続テスト。
//   ・一覧は RLS(運営) で直接取得。変更は /api/line/accounts（サーバーで暗号化・LINE呼び出し）。
//   ・シークレット/アクセストークンは登録専用（表示しない）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { useConfirm } from "../components/common/ConfirmProvider";
import type { LineAccount, LineAccountEnv } from "../lib/models";
import {
  fetchLineAccounts, fetchLineFriendCounts,
  createLineAccount, updateLineAccount, deleteLineAccount, testLineAccount,
} from "../lib/lineAccounts";

function webhookUrl(channelId: string): string {
  const base =
    (typeof window !== "undefined" && window.location?.origin) ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";
  return `${base}/api/line/webhook/${channelId}`;
}

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  connected:    { label: "接続中",   cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  needs_action: { label: "要対応",   cls: "bg-amber-100 text-amber-700",    dot: "bg-amber-500" },
  paused:       { label: "停止中",   cls: "bg-gray-100 text-gray-500",      dot: "bg-gray-400" },
};

interface FormState { id?: number; name: string; channelId: string; env: LineAccountEnv; channelSecret: string; accessToken: string }
const EMPTY_FORM: FormState = { name: "", channelId: "", env: "prod", channelSecret: "", accessToken: "" };

export function LineAccountsView() {
  const { can } = useMaster();
  const confirm = useConfirm();
  const canManage = can("line_account");

  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setAccounts(await fetchLineAccounts());
    setCounts(await fetchLineFriendCounts());
  }, []);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    connected: accounts.filter((a) => a.status === "connected").length,
    needsAction: accounts.filter((a) => a.status === "needs_action").length,
    friends: Object.values(counts).reduce((s, n) => s + n, 0),
  }), [accounts, counts]);

  const isEdit = form.id != null;

  const openAdd = () => { setForm(EMPTY_FORM); setFormError(""); setModalOpen(true); };
  const openEdit = (a: LineAccount) => {
    setForm({ id: a.id, name: a.name, channelId: a.channelId, env: a.env, channelSecret: "", accessToken: "" });
    setFormError(""); setModalOpen(true);
  };

  const submit = async () => {
    setFormError("");
    if (isEdit) {
      setSaving(true);
      const r = await updateLineAccount(form.id as number, {
        name: form.name, env: form.env,
        channelSecret: form.channelSecret || undefined,
        accessToken: form.accessToken || undefined,
      });
      setSaving(false);
      if (!r.ok) { setFormError(r.error ?? "更新に失敗しました"); return; }
    } else {
      if (!form.channelId.trim() || !form.channelSecret.trim() || !form.accessToken.trim()) {
        setFormError("チャネルID・シークレット・アクセストークンは必須です"); return;
      }
      setSaving(true);
      const r = await createLineAccount({
        name: form.name || form.channelId, channelId: form.channelId, env: form.env,
        channelSecret: form.channelSecret, accessToken: form.accessToken,
      });
      setSaving(false);
      if (!r.ok) { setFormError(r.error ?? "追加に失敗しました"); return; }
    }
    setModalOpen(false);
    await load();
  };

  const runTest = async (a: LineAccount) => {
    setBusyId(a.id);
    await testLineAccount(a.id);
    setBusyId(null);
    await load();
  };

  const togglePause = async (a: LineAccount) => {
    setBusyId(a.id);
    await updateLineAccount(a.id, { status: a.status === "paused" ? "needs_action" : "paused" });
    setBusyId(null);
    await load();
  };

  const remove = async (a: LineAccount) => {
    const ok = await confirm({
      title: "アカウントを削除しますか？",
      message: `「${a.name || a.channelId}」を削除します。この操作は取り消せません。\n紐づく友だち・トーク履歴・配信ログがアプリから参照できなくなります（LINE側のデータは消えません）。\n\n受信を止めたいだけなら「停止」を使ってください。`,
    });
    if (!ok) return;
    setBusyId(a.id);
    await deleteLineAccount(a.id);
    setBusyId(null);
    await load();
  };

  const copyUrl = (channelId: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(webhookUrl(channelId));
  };

  return (
    <div className="h-full overflow-auto p-5">
      <div className="flex items-center gap-3 mb-4">
        <div>
          <h1 className="text-lg font-extrabold">LINEアカウント</h1>
          <div className="text-xs text-gray-500">接続中の公式LINEアカウントの管理（接続テスト・編集・削除）</div>
        </div>
        {canManage && (
          <button onClick={openAdd} className="ml-auto bg-emerald-500 text-white font-bold text-[12.5px] rounded-lg px-4 py-2">
            ＋ アカウントを追加
          </button>
        )}
      </div>

      <div className="flex gap-3 mb-5 flex-wrap">
        {([["接続中", stats.connected], ["要対応", stats.needsAction], ["友だち合計", stats.friends]] as const).map(([k, v]) => (
          <div key={k} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 min-w-[120px]">
            <div className="text-[10.5px] text-gray-500">{k}</div>
            <div className="text-xl font-extrabold">{v}</div>
          </div>
        ))}
      </div>

      {accounts.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
          まだアカウントが登録されていません。「＋ アカウントを追加」から接続してください。
        </div>
      )}

      {accounts.map((a) => {
        const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.needs_action;
        const busy = busyId === a.id;
        return (
          <div key={a.id} className={`bg-white border rounded-2xl p-4 mb-3 flex gap-4 ${a.status === "needs_action" ? "border-amber-200 bg-amber-50/40" : "border-gray-200"}`}>
            <div className="w-12 h-12 rounded-xl grid place-items-center text-white font-extrabold text-base flex-shrink-0" style={{ background: a.status === "connected" ? "#06c755" : a.status === "needs_action" ? "#c2860b" : "#9aa0a6" }}>
              {(a.name || a.channelId).charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold flex items-center gap-2 flex-wrap">
                {a.name || "(名称未設定)"}
                <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-0.5 rounded-full ${st.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                </span>
                <span className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{a.env === "test" ? "テスト" : "本番"}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 mt-2.5">
                <div><div className="text-[10.5px] text-gray-500">チャネルID</div><div className="text-[13px] font-bold font-mono">{a.channelId}</div></div>
                <div><div className="text-[10.5px] text-gray-500">ベーシックID</div><div className="text-[13px] font-bold font-mono">{a.basicId || "—"}</div></div>
                <div><div className="text-[10.5px] text-gray-500">友だち</div><div className="text-[13px] font-bold">{counts[a.id] ?? 0}</div></div>
                <div><div className="text-[10.5px] text-gray-500">最終テスト</div><div className="text-[13px] font-bold">{a.lastTestAt ? new Date(a.lastTestAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</div></div>
              </div>
              {a.status !== "connected" && a.statusDetail && (
                <div className="text-[11.5px] text-amber-700 mt-2">{a.statusDetail}</div>
              )}
              <div className="mt-2.5 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <code className="text-[11px] font-mono text-gray-600 flex-1 overflow-auto whitespace-nowrap bg-white border border-blue-100 rounded px-2 py-1">{webhookUrl(a.channelId)}</code>
                <button onClick={() => copyUrl(a.channelId)} className="text-[11px] font-bold text-blue-600 border border-blue-200 bg-white rounded-md px-2.5 py-1 flex-shrink-0">コピー</button>
              </div>
              <div className="text-[10.5px] text-gray-400 mt-1">↑ このURLをLINE DevelopersのWebhook URLに設定し、Webhookの利用をONにしてください。</div>
            </div>
            {canManage && (
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={() => runTest(a)} disabled={busy} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50">{busy ? "テスト中" : "接続テスト"}</button>
                <button onClick={() => openEdit(a)} disabled={busy} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50">編集</button>
                <button onClick={() => togglePause(a)} disabled={busy} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50">{a.status === "paused" ? "再開" : "停止"}</button>
                <button onClick={() => remove(a)} disabled={busy} className="text-[12px] font-bold border border-red-200 text-red-600 rounded-lg px-3 py-1.5 disabled:opacity-50">削除</button>
              </div>
            )}
          </div>
        );
      })}

      {/* 追加/編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-[540px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200"><h3 className="font-extrabold text-[15px]">{isEdit ? "アカウントを編集" : "アカウントを追加"}</h3></div>
            <div className="px-5 py-4 max-h-[70vh] overflow-auto">
              {!isEdit && (
                <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-4">
                  LINE Developers で <b>Messaging APIチャネル</b> を作成し（LINEログインと同一プロバイダー配下）、チャネルID・チャネルシークレット・チャネルアクセストークン（長期）を控えてから入力してください。
                </div>
              )}
              <div className="mb-3">
                <label className="block text-[12px] font-bold mb-1">表示名</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="KAWAI CAMP サブ（セミナー用）" />
              </div>
              <div className="mb-3">
                <label className="block text-[12px] font-bold mb-1">チャネルID</label>
                <input value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} disabled={isEdit} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono bg-gray-50 disabled:opacity-60" placeholder="2007xxxxxx" />
                {isEdit && <div className="text-[11px] text-gray-400 mt-1">チャネルIDは変更できません。</div>}
              </div>
              <div className="mb-3">
                <label className="block text-[12px] font-bold mb-1">チャネルシークレット{isEdit && <span className="text-gray-400 font-normal">（変更する場合のみ）</span>}</label>
                <input type="password" value={form.channelSecret} onChange={(e) => setForm({ ...form, channelSecret: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono bg-gray-50" placeholder={isEdit ? "（変更しない場合は空欄）" : ""} />
              </div>
              <div className="mb-3">
                <label className="block text-[12px] font-bold mb-1">チャネルアクセストークン（長期）{isEdit && <span className="text-gray-400 font-normal">（変更する場合のみ）</span>}</label>
                <input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono bg-gray-50" placeholder={isEdit ? "（変更しない場合は空欄）" : ""} />
                <div className="text-[11px] text-gray-400 mt-1">DBに暗号化して保存します（画面には再表示されません）。</div>
              </div>
              <div className="mb-1">
                <label className="block text-[12px] font-bold mb-1">区分</label>
                <select value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value as LineAccountEnv })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                  <option value="prod">本番</option><option value="test">テスト</option>
                </select>
              </div>
              {formError && <div className="text-[12px] text-red-600 mt-3">{formError}</div>}
              {!isEdit && <div className="text-[11px] text-gray-500 mt-3">保存すると自動で接続テストを実行し、Webhook URLを発行します。</div>}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3.5 py-2">キャンセル</button>
              <button onClick={submit} disabled={saving} className="text-[12.5px] font-bold bg-emerald-500 text-white rounded-lg px-4 py-2 disabled:opacity-50">{saving ? "保存中…" : isEdit ? "保存" : "保存して接続テスト"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
