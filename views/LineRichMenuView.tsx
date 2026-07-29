"use client";
// リッチメニュー管理（Phase 5b）：作成・画像・タップ領域（レイアウト＋アクション）・公開/既定/削除。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLineAccounts } from "../hooks/useLineAccounts";
import { useConfirm } from "../components/common/ConfirmProvider";
import type { LineRichMenu, RichMenuCell, RichMenuSize, RichMenuActionType } from "../lib/models";
import {
  fetchRichMenus, saveRichMenu, uploadRichMenuImage, richMenuImageUrl,
  publishRichMenu, setRichMenuDefault, deleteRichMenu,
} from "../lib/lineRichMenu";
import { LineAccountBar } from "../components/line/LineAccountBar";

const LAYOUTS: { key: string; label: string; cols: number; rows: number }[] = [
  { key: "1x1", label: "全体1つ", cols: 1, rows: 1 },
  { key: "2x1", label: "横2分割", cols: 2, rows: 1 },
  { key: "3x1", label: "横3分割", cols: 3, rows: 1 },
  { key: "1x2", label: "縦2段", cols: 1, rows: 2 },
  { key: "2x2", label: "2×2", cols: 2, rows: 2 },
  { key: "3x2", label: "3×2（6分割）", cols: 3, rows: 2 },
];
const cellCountOf = (key: string) => {
  const l = LAYOUTS.find((x) => x.key === key) ?? LAYOUTS[1];
  return l.cols * l.rows;
};
const ACTION_LABEL: Record<RichMenuActionType, string> = { liff: "会員連携フォーム(LIFF)", liff_mypage: "マイページ(LIFF)", uri: "URLを開く", message: "テキスト送信" };
const emptyCell = (): RichMenuCell => ({ label: "", actionType: "liff", actionValue: "" });

interface Form {
  id?: number; name: string; chatBarText: string; size: RichMenuSize; layout: string;
  imagePath: string; cells: RichMenuCell[]; isDefault: boolean;
}
const EMPTY: Form = { name: "", chatBarText: "メニュー", size: "full", layout: "2x1", imagePath: "", cells: [emptyCell(), emptyCell()], isDefault: false };

export function LineRichMenuView() {
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const confirm = useConfirm();
  const [menus, setMenus] = useState<LineRichMenu[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => { setMenus(await fetchRichMenus(accountId)); }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm({ ...EMPTY, cells: [emptyCell(), emptyCell()] }); setErr(""); setOpen(true); };
  const openEdit = (m: LineRichMenu) => {
    setForm({ id: m.id, name: m.name, chatBarText: m.chatBarText, size: m.size, layout: m.layout, imagePath: m.imagePath, cells: m.cells.length ? m.cells : [emptyCell()], isDefault: m.isDefault });
    setErr(""); setOpen(true);
  };

  const setLayout = (key: string) => {
    const n = cellCountOf(key);
    setForm((f) => {
      const cells = [...f.cells];
      while (cells.length < n) cells.push(emptyCell());
      cells.length = n;
      return { ...f, layout: key, cells };
    });
  };
  const setCell = (i: number, p: Partial<RichMenuCell>) =>
    setForm((f) => ({ ...f, cells: f.cells.map((c, idx) => idx === i ? { ...c, ...p } : c) }));

  const onImage = async (file: File) => {
    if (accountId == null) return;
    setUploading(true); setErr("");
    const r = await uploadRichMenuImage(accountId, file);
    setUploading(false);
    if (r.error) { setErr(r.error); return; }
    setForm((f) => ({ ...f, imagePath: r.path }));
  };

  const save = async (): Promise<number | null> => {
    if (accountId == null) { setErr("アカウントを選択してください"); return null; }
    setBusy(true); setErr("");
    const id = await saveRichMenu({
      id: form.id, accountId, name: form.name, chatBarText: form.chatBarText,
      size: form.size, layout: form.layout, imagePath: form.imagePath, cells: form.cells, isDefault: form.isDefault,
    });
    setBusy(false);
    if (id == null) { setErr("保存に失敗しました"); return null; }
    setForm((f) => ({ ...f, id }));
    await load();
    return id;
  };
  const saveClose = async () => { const id = await save(); if (id != null) setOpen(false); };
  const publish = async () => {
    const id = await save();
    if (id == null) return;
    if (!form.imagePath) { setErr("画像を設定してください"); return; }
    setBusy(true);
    const r = await publishRichMenu(id);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "公開に失敗しました"); return; }
    setOpen(false); await load();
  };
  const makeDefault = async (m: LineRichMenu) => { setBusy(true); const r = await setRichMenuDefault(m.id); setBusy(false); if (!r.ok) alert(r.error ?? "失敗"); await load(); };
  const remove = async (m: LineRichMenu) => {
    if (!(await confirm({ title: "リッチメニューを削除", message: `「${m.name || "無題"}」を削除します。LINE上のメニューも削除されます。` }))) return;
    setBusy(true); await deleteRichMenu(m.id); setBusy(false); await load();
  };

  const layoutMeta = useMemo(() => LAYOUTS.find((x) => x.key === form.layout) ?? LAYOUTS[1], [form.layout]);
  const previewUrl = form.imagePath ? richMenuImageUrl(form.imagePath) : "";

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="リッチメニュー" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />
      <div className="flex-1 overflow-auto p-5">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-lg font-extrabold">リッチメニュー</h1>
          <span className="text-xs text-gray-500">LINEトーク下部の固定メニュー</span>
          <button onClick={openNew} disabled={accountId == null} className="ml-auto bg-emerald-500 text-white font-bold text-[12.5px] rounded-lg px-4 py-2 disabled:opacity-50">＋ 作成</button>
        </div>

        {menus.length === 0 && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
            まだリッチメニューがありません。「＋ 作成」から追加してください。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {menus.map((m) => (
            <div key={m.id} className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <b className="text-[14px]">{m.name || "（無題）"}</b>
                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${m.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.status === "published" ? "公開中" : "下書き"}</span>
                {m.isDefault && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">既定</span>}
              </div>
              {m.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={richMenuImageUrl(m.imagePath)} alt="" className="w-full rounded-lg border border-gray-100 mb-2" />
              )}
              <div className="text-[11.5px] text-gray-500 mb-2">バー表示: {m.chatBarText}／{m.size === "full" ? "大" : "小"}・{m.layout}</div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => openEdit(m)} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">編集</button>
                {m.status === "published" && !m.isDefault && <button onClick={() => makeDefault(m)} disabled={busy} className="text-[12px] font-bold border border-emerald-300 text-emerald-700 rounded-lg px-3 py-1.5">既定にする</button>}
                <button onClick={() => remove(m)} disabled={busy} className="text-[12px] font-bold border border-red-200 text-red-600 rounded-lg px-3 py-1.5 ml-auto">削除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-[560px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200"><h3 className="font-extrabold text-[15px]">{form.id ? "リッチメニューを編集" : "リッチメニューを作成"}</h3></div>
            <div className="px-5 py-4 max-h-[72vh] overflow-auto">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="block text-[12px] font-bold mb-1">名前（管理用）</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="7月メニュー" /></div>
                <div><label className="block text-[12px] font-bold mb-1">バーの表示テキスト</label>
                  <input value={form.chatBarText} maxLength={14} onChange={(e) => setForm({ ...form, chatBarText: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="メニュー" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="block text-[12px] font-bold mb-1">サイズ</label>
                  <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as RichMenuSize })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                    <option value="full">大（2500×1686）</option><option value="compact">小（2500×843）</option>
                  </select></div>
                <div><label className="block text-[12px] font-bold mb-1">レイアウト</label>
                  <select value={form.layout} onChange={(e) => setLayout(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                    {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select></div>
              </div>

              <div className="mb-3">
                <label className="block text-[12px] font-bold mb-1">メニュー画像 <span className="text-gray-400 font-normal">JPEG/PNG・1MBまで・{form.size === "full" ? "2500×1686" : "2500×843"}px</span></label>
                <input type="file" accept="image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); }} className="text-[12px]" />
                {uploading && <span className="text-[12px] text-gray-400 ml-2">アップロード中…</span>}
                {previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="w-full rounded-lg border border-gray-100 mt-2" />
                )}
              </div>

              <div className="mb-2">
                <label className="block text-[12px] font-bold mb-1">タップ領域（{layoutMeta.cols}×{layoutMeta.rows}＝{form.cells.length}マス・左上から順）</label>
                <div className="space-y-2">
                  {form.cells.map((c, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50">
                      <div className="text-[11px] font-bold text-gray-500 mb-1">マス {i + 1}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={c.label} onChange={(e) => setCell(i, { label: e.target.value })} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white" placeholder="ラベル（任意）" />
                        <select value={c.actionType} onChange={(e) => setCell(i, { actionType: e.target.value as RichMenuActionType })} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
                          {(Object.keys(ACTION_LABEL) as RichMenuActionType[]).map((k) => <option key={k} value={k}>{ACTION_LABEL[k]}</option>)}
                        </select>
                      </div>
                      {(c.actionType === "uri" || c.actionType === "message") && (
                        <input value={c.actionValue} onChange={(e) => setCell(i, { actionValue: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white mt-2"
                          placeholder={c.actionType === "uri" ? "https://…" : "送信するテキスト"} />
                      )}
                      {c.actionType === "liff" && <div className="text-[10.5px] text-gray-400 mt-1">このアカウントのLIFF会員連携フォームを開きます（LIFF ID未設定だと無効）。</div>}
                      {c.actionType === "liff_mypage" && <div className="text-[10.5px] text-gray-400 mt-1">LINE内の会員マイページを開きます（LIFF ID未設定だと無効）。</div>}
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-[12.5px] mt-2">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                公開時に全員の既定メニューにする
              </label>
              {err && <div className="text-[12px] text-red-600 mt-2">{err}</div>}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3.5 py-2">閉じる</button>
              <button onClick={saveClose} disabled={busy || uploading} className="text-[12.5px] font-bold border border-gray-300 rounded-lg px-4 py-2 disabled:opacity-50">下書き保存</button>
              <button onClick={publish} disabled={busy || uploading} className="text-[12.5px] font-bold bg-emerald-500 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "処理中…" : "保存してLINEに公開"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
