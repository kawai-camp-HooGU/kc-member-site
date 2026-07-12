"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchNews, saveNews, deleteNews, setNewsPublished, saveNewsOrder } from "../../lib/news";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex, attrSegs, attrLabel } from "../../lib/members";
import { renderBodyHtml } from "../../lib/richText";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { AttrCascadePicker } from "../master/AttrCascadePicker";
import type { NewsItem, NewsCategory, PublishMode } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ", cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス", cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント", cls: "bg-emerald-50 text-emerald-600" },
};
const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const MODE_LABEL: Record<PublishMode, string> = { any: "いずれか含む", all: "すべて含む", exany: "いずれか含むを除外", exall: "すべて含むを除外" };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fmt = (s: string) => (s ? s.replace("T", " ") : "—");
const bodyHtml = (n: NewsItem) => renderBodyHtml(n.bodyMode, n.bodyText, n.bodyHtml);
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

function TargetTags({ attrIds, mode, index }: { attrIds: number[]; mode: PublishMode; index: AttrIndex }) {
  if (!attrIds.length) return <span className="text-gray-400">全員</span>;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-gray-400">（{MODE_LABEL[mode]}）</span>
      {attrIds.map((id) => { const s = attrSegs(index, id); const last = s[s.length - 1] ?? { color: "#9ca3af" };
        return <span key={id} className="text-[10px] px-2 py-0.5 rounded-full border" style={{ borderColor: `${last.color}55`, color: last.color, background: `${last.color}0f` }}>{attrLabel(index, id)}</span>; })}
    </span>
  );
}

export function NewsMaint() {
  const confirm = useConfirm();
  const toast = useToast();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<NewsItem | null>(null);
  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  const reload = async () => setNews(await fetchNews());
  useEffect(() => {
    (async () => {
      try { const [n, t] = await Promise.all([fetchNews(), loadAttributeTree()]); setNews(n); setTree(t); }
      catch (e) { console.error("お知らせ読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const rows = [...news].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const newItem = (): NewsItem => ({
    id: 0, category: "notice", title: "", bodyMode: "text", bodyText: "", bodyHtml: "",
    important: false, published: true, publishedAt: nowLocal(), attrMode: "any", attrIds: [], sortOrder: rows.length,
  });

  const move = async (idx: number, dir: number) => {
    const to = idx + dir; if (to < 0 || to >= rows.length) return;
    const arr = [...rows]; [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((n, i) => ({ id: n.id, sortOrder: i }));
    setNews((prev) => prev.map((n) => { const u = updates.find((x) => x.id === n.id); return u ? { ...n, sortOrder: u.sortOrder } : n; }));
    await saveNewsOrder(updates);
  };
  const togglePub = async (n: NewsItem) => { await setNewsPublished(n.id, !n.published); setNews((p) => p.map((x) => x.id === n.id ? { ...x, published: !x.published } : x)); };
  const doSave = async () => { if (!edit) return; if (!edit.title.trim()) { alert("タイトルを入力してください"); return; } const id = await saveNews(edit); if (id == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; } setEdit(null); await reload(); toast.success("保存しました"); };
  const doDelete = async () => { if (!edit?.id) return; if (!(await confirm({ title: "お知らせを削除", message: `「${edit.title}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return; await deleteNews(edit.id); setEdit(null); await reload(); toast.success("削除しました"); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 m-0">{news.length} 件（公開 {news.filter((n) => n.published).length}）</p>
        <button onClick={() => setEdit(newItem())} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ お知らせを追加</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {rows.length === 0 && <div className="text-center text-gray-300 py-10 text-sm">お知らせがありません</div>}
        {rows.map((n, i) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-800 flex items-center gap-1.5 flex-wrap">
                {n.title || "（無題）"}
                {!n.published && <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">下書き</span>}
              </div>
              <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-1">
                {n.important && <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">重要</span>}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CATS[n.category].cls}`}>{CATS[n.category].label}</span>
                <span>公開：{fmt(n.publishedAt)}</span>
                <TargetTags attrIds={n.attrIds} mode={n.attrMode} index={index} />
              </div>
            </div>
            <button onClick={() => togglePub(n)} title="公開/非公開" className={`relative w-10 h-[21px] rounded-full shrink-0 ${n.published ? "bg-green-500" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${n.published ? "left-[21px]" : "left-0.5"}`} />
            </button>
            <button onClick={() => setEdit({ ...n })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
          </div>
        ))}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{edit.id ? "お知らせを編集" : "お知らせを追加"}</h2>
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">カテゴリ</label>
                  <select className={`${input} bg-white`} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as NewsCategory })}>
                    {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">公開日時 <span className="text-gray-400 font-normal">未来日で予約公開</span></label>
                  <input type="datetime-local" className={input} value={edit.publishedAt} onChange={(e) => setEdit({ ...edit, publishedAt: e.target.value })} /></div>
              </div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">タイトル <span className="text-red-500">*</span></label>
                <input className={input} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>

              <div>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5 mb-2">
                  {(["text", "html"] as const).map((m) => (
                    <button key={m} onClick={() => setEdit({ ...edit, bodyMode: m })}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md ${edit.bodyMode === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>{m === "text" ? "テキスト" : "HTMLコード"}</button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mb-1.5">テキストはURLを自動リンク化、HTMLはそのまま反映されます。</p>
                {edit.bodyMode === "text"
                  ? <textarea className={`${input} min-h-[130px]`} value={edit.bodyText} onChange={(e) => setEdit({ ...edit, bodyText: e.target.value })} placeholder="本文（テキスト）" />
                  : <textarea className={`${input} min-h-[130px] font-mono text-[13px]`} value={edit.bodyHtml} onChange={(e) => setEdit({ ...edit, bodyHtml: e.target.value })} placeholder="<h3>見出し</h3>…" />}
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-gray-400 font-normal">未選択なら全員</span></label>
                <AttrCascadePicker tree={tree} index={index} value={edit.attrIds} onChange={(ids) => setEdit({ ...edit, attrIds: ids })} />
                <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                  <select className={`${input} bg-white`} value={edit.attrMode} onChange={(e) => setEdit({ ...edit, attrMode: e.target.value as PublishMode })}>
                    {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">重要（ピン留め）</label>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => setEdit({ ...edit, important: !edit.important })} className={`relative w-10 h-[21px] rounded-full ${edit.important ? "bg-red-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.important ? "left-[21px]" : "left-0.5"}`} /></button>
                    <span className="text-xs text-gray-600">一覧の先頭に「重要」表示</span>
                  </div></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">公開状態</label>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => setEdit({ ...edit, published: !edit.published })} className={`relative w-10 h-[21px] rounded-full ${edit.published ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.published ? "left-[21px]" : "left-0.5"}`} /></button>
                    <span className="text-xs text-gray-600">{edit.published ? "公開" : "下書き"}</span>
                  </div></div>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1.5">プレビュー</label>
                <div className="border border-dashed border-gray-300 rounded-xl p-3 bg-gray-50">
                  <div className="text-[10px] text-gray-400 mb-2">{edit.important ? "重要・" : ""}{CATS[edit.category].label}　{edit.title || "（タイトル）"}</div>
                  <div className="text-[13.5px] leading-7 text-gray-700 bg-white border border-gray-200 rounded-lg p-3 content-rich"
                    dangerouslySetInnerHTML={{ __html: bodyHtml(edit) || "（本文未入力）" }} />
                </div></div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {edit.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={() => setEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
