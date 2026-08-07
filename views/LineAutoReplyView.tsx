"use client";
// キーワード自動応答（Phase 7③）：ルール一覧＋編集。返信＝リッチメッセージ、発火＝アクション基盤。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLineAccounts } from "../hooks/useLineAccounts";
import { useConfirm } from "../components/common/ConfirmProvider";
import type { AutoReplyRule, AutoReplyMatch, RichMessage, FormAction } from "../lib/models";
import { fetchAutoReplies, saveAutoReply, deleteAutoReply } from "../lib/lineAutoReply";
import { LineAccountBar } from "../components/line/LineAccountBar";
import { RichMessageEditor } from "../components/line/RichMessageEditor";
import { ActionEditor } from "../components/form/ActionEditor";
import type { ScenarioOpt } from "../components/form/ActionEditor";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { fetchScenarios } from "../lib/scenario";

const MATCH: { k: AutoReplyMatch; l: string }[] = [
  { k: "partial", l: "部分一致" }, { k: "exact", l: "完全一致" }, { k: "regex", l: "正規表現" },
];
const matchLabel = (m: AutoReplyMatch) => MATCH.find((x) => x.k === m)?.l ?? "部分一致";

interface Form {
  id?: number; name: string; keywords: string; matchType: AutoReplyMatch; isFallback: boolean;
  reply: RichMessage | null; actions: FormAction[]; priority: number; enabled: boolean;
}
const EMPTY: Form = { name: "", keywords: "", matchType: "partial", isFallback: false, reply: { type: "text", text: "" }, actions: [], priority: 0, enabled: true };
const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50";

export function LineAutoReplyView() {
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const confirm = useConfirm();
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOpt[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  const load = useCallback(async () => { setRules(await fetchAutoReplies(accountId)); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadAttributeTree().then(setTree).catch(() => setTree([]));
    fetchScenarios().then((s) => setScenarios(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => setScenarios([]));
  }, []);

  const openNew = () => { setForm(EMPTY); setErr(""); setOpen(true); };
  const openEdit = (r: AutoReplyRule) => {
    setForm({ id: r.id, name: r.name, keywords: r.keywords.join(", "), matchType: r.matchType, isFallback: r.isFallback, reply: r.reply, actions: r.actions, priority: r.priority, enabled: r.enabled });
    setErr(""); setOpen(true);
  };

  const save = async () => {
    if (accountId == null) { setErr("アカウントを選択してください"); return; }
    const keywords = form.keywords.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    if (!form.isFallback && keywords.length === 0) { setErr("キーワードを1つ以上入力してください（フォールバックはキーワード不要）"); return; }
    setBusy(true); setErr("");
    const id = await saveAutoReply({
      id: form.id, accountId, name: form.name, keywords, matchType: form.matchType,
      isFallback: form.isFallback, reply: form.reply, actions: form.actions, priority: form.priority, enabled: form.enabled,
    });
    setBusy(false);
    if (id == null) { setErr("保存に失敗しました"); return; }
    setOpen(false); await load();
  };
  const remove = async (r: AutoReplyRule) => {
    if (!(await confirm({ title: "自動応答を削除", message: `「${r.name || r.keywords.join("/") || "無題"}」を削除します。` }))) return;
    setBusy(true); await deleteAutoReply(r.id); setBusy(false); await load();
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="自動応答" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />

      {!open ? (
        <div className="flex-1 overflow-auto p-5">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-lg font-extrabold">キーワード自動応答</h1>
            <span className="text-xs text-gray-500">受信ワードに自動返信＋アクション（返信は無料のReply）</span>
            <button onClick={openNew} disabled={accountId == null} className="ml-auto bg-emerald-500 text-white font-bold text-[12.5px] rounded-lg px-4 py-2 disabled:opacity-50">＋ ルールを作成</button>
          </div>

          {rules.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
              まだルールがありません。「＋ ルールを作成」から追加してください。上から順に評価し、最初に一致したルールを実行します。
            </div>
          )}

          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{r.enabled ? "有効" : "無効"}</span>
                {r.isFallback
                  ? <b className="text-[13.5px]">その他すべて（フォールバック）</b>
                  : <b className="text-[13.5px]">{r.keywords.join(" / ") || "（キーワード未設定）"}</b>}
                <span className="text-[11px] text-gray-400">{r.isFallback ? "" : matchLabel(r.matchType)}</span>
                {r.reply && <span className="text-[10.5px] text-gray-500">💬 返信あり</span>}
                {r.actions.length > 0 && <span className="text-[10.5px] text-indigo-500 font-bold">⚡ アクション{r.actions.length}</span>}
                {r.priority !== 0 && <span className="text-[10.5px] text-gray-400">優先{r.priority}</span>}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => openEdit(r)} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">編集</button>
                  <button onClick={() => remove(r)} disabled={busy} className="text-[12px] font-bold border border-red-200 text-red-600 rounded-lg px-3 py-1.5">削除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto">
            <div className="max-w-[820px] mx-auto px-5 pt-4 pb-6 space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3 py-1.5">← 一覧に戻る</button>
                <h1 className="text-lg font-extrabold">{form.id ? "自動応答を編集" : "自動応答を作成"}</h1>
              </div>

              <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[12px] font-bold mb-1">名前（管理用）</label>
                    <input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="料金の問い合わせ" /></div>
                  <div><label className="block text-[12px] font-bold mb-1">優先度 <span className="text-gray-400 font-normal">大きいほど先に評価</span></label>
                    <input type="number" className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} /></div>
                </div>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={form.isFallback} onChange={(e) => setForm({ ...form, isFallback: e.target.checked })} />
                  フォールバック（キーワード不一致のときに実行＝「その他すべて」）
                </label>
                {!form.isFallback && (
                  <div className="grid grid-cols-[1fr_160px] gap-3">
                    <div><label className="block text-[12px] font-bold mb-1">キーワード <span className="text-gray-400 font-normal">カンマ区切り・いずれか一致</span></label>
                      <input className={inp} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="料金, 価格, いくら" /></div>
                    <div><label className="block text-[12px] font-bold mb-1">一致方法</label>
                      <select className={inp} value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as AutoReplyMatch })}>
                        {MATCH.map((m) => <option key={m.k} value={m.k}>{m.l}</option>)}
                      </select></div>
                  </div>
                )}
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                  有効
                </label>
              </section>

              <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="text-[13.5px] font-extrabold mb-2">返信メッセージ <span className="text-gray-400 font-normal text-[12px]">（無料のReplyで送信・任意）</span></div>
                <RichMessageEditor value={form.reply} onChange={(mj) => setForm({ ...form, reply: mj })} accountId={accountId} />
              </section>

              <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="text-[13.5px] font-extrabold mb-2">実行アクション <span className="text-gray-400 font-normal text-[12px]">（属性付与・シナリオ開始・メッセージ送信）</span></div>
                <ActionEditor actions={form.actions} onChange={(a) => setForm({ ...form, actions: a })} tree={tree} index={index} scenarios={scenarios} allowSignup={false} onTreeChange={setTree} />
              </section>

              {err && <div className="text-[12px] text-red-600">{err}</div>}
            </div>
          </div>
          <div className="border-t border-gray-200 bg-white/95 px-5 py-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3.5 py-2">キャンセル</button>
            <button onClick={save} disabled={busy} className="text-[12.5px] font-bold bg-emerald-500 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "保存中…" : "保存"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
