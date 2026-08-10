"use client";
// テンプレート（定型文）管理（Phase P2-B）：一覧＋編集。内容は RichMessage。
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../components/common/ConfirmProvider";
import type { LineTemplate, RichMessage } from "../lib/models";
import { fetchTemplates, saveTemplate, deleteTemplate } from "../lib/lineTemplates";
import { RichMessageEditor } from "../components/line/RichMessageEditor";
import { useLineAccounts } from "../hooks/useLineAccounts";
import { LineAccountBar } from "../components/line/LineAccountBar";

const TYPE_LABEL: Record<string, string> = { text: "テキスト", image: "画像", buttons: "カード", carousel: "カルーセル" };

export function LineTemplatesView() {
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const confirm = useConfirm();
  const [list, setList] = useState<LineTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<number | undefined>(undefined);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<RichMessage | null>({ type: "text", text: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => { setList(await fetchTemplates()); }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setId(undefined); setName(""); setMessage({ type: "text", text: "" }); setErr(""); setOpen(true); };
  const openEdit = (t: LineTemplate) => { setId(t.id); setName(t.name); setMessage(t.message); setErr(""); setOpen(true); };

  const save = async () => {
    if (!name.trim()) { setErr("テンプレート名を入力してください"); return; }
    setBusy(true); setErr("");
    const r = await saveTemplate({ id, name: name.trim(), message: message ?? { type: "text", text: "" } });
    setBusy(false);
    if (r == null) { setErr("保存に失敗しました"); return; }
    setOpen(false); await load();
  };
  const remove = async (t: LineTemplate) => {
    if (!(await confirm({ title: "テンプレートを削除", message: `「${t.name}」を削除します。` }))) return;
    setBusy(true); await deleteTemplate(t.id); setBusy(false); await load();
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="テンプレート" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />

      {!open ? (
        <div className="flex-1 overflow-auto p-5">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-lg font-extrabold">テンプレート</h1>
            <span className="text-xs text-gray-500">定型文・定型リッチメッセージ。配信/シナリオ/自動応答から挿入できます</span>
            <button onClick={openNew} className="ml-auto bg-emerald-500 text-white font-bold text-[12.5px] rounded-lg px-4 py-2">＋ 作成</button>
          </div>

          {list.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
              まだテンプレートがありません。「＋ 作成」から追加してください。
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map((t) => (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <b className="text-[14px]">{t.name}</b>
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{TYPE_LABEL[t.message.type] ?? t.message.type}</span>
                </div>
                <div className="text-[12px] text-gray-500 truncate mb-2">
                  {t.message.type === "text" ? (t.message.text || "（空）") : t.message.type === "buttons" ? (t.message.card?.title || t.message.card?.text || "カード") : t.message.type === "carousel" ? `${t.message.cards?.length ?? 0}枚のカード` : "画像"}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(t)} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">編集</button>
                  <button onClick={() => remove(t)} disabled={busy} className="text-[12px] font-bold border border-red-200 text-red-600 rounded-lg px-3 py-1.5 ml-auto">削除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto">
            <div className="max-w-[720px] mx-auto px-5 pt-4 pb-6 space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3 py-1.5">← 一覧に戻る</button>
                <h1 className="text-lg font-extrabold">{id ? "テンプレートを編集" : "テンプレートを作成"}</h1>
              </div>
              <div>
                <label className="block text-[12px] font-bold mb-1">テンプレート名</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="料金案内" />
              </div>
              <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="text-[13.5px] font-extrabold mb-2">内容</div>
                <RichMessageEditor value={message} onChange={setMessage} accountId={accountId} />
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
