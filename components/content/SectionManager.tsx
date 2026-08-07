"use client";
// ============================================================
// コンテンツ「セクション（入口）」管理（運営）
//
//   会員ポータルのコンテンツ入口（サイドバー項目＝ハブ）を運営が増減・編集する。
//   1セクション＝1入口。ページは編集画面で「所属セクション」を選んで振り分ける。
//
//   ・公開ON/OFF・並び順・公開対象属性（ページと同じ AttrTable/canView 方式）を設定可能
//   ・既定セクション（is_default）は削除不可（未所属ページの受け皿）
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  fetchContentSections, saveSection, deleteSection, setSectionPublished, saveSectionOrder,
} from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { AttrNode } from "../../lib/attributes";
import { AttrTable } from "../master/AttrTable";
import { AttrChips } from "../master/AttrChips";
import { Icon } from "../common/Icon";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
import type { ContentSection, ContentPage, PublishMode } from "../../lib/models";

const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const input = FIELD_INPUT;

const newSection = (sortOrder: number): ContentSection => ({
  id: 0, name: "", icon: "", overview: "", sortOrder, published: true,
  attrMode: "any", attrIds: [], isDefault: false,
});

/**
 * @param pages 所属ページ数の表示に使う（会員に見えるかとは無関係の総数）
 * @param onChanged セクションが増減・改名されたら親（＋サイドバー）を更新するために呼ぶ
 */
export function SectionManager({ pages, onChanged }: { pages: ContentPage[]; onChanged?: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<ContentSection | null>(null);
  const [publishAll, setPublishAll] = useState(false);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);
  const sorted = useMemo(() => [...sections].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id), [sections]);
  const pageCount = (sid: number) => pages.filter((p) => p.sectionId === sid).length;

  const reload = async () => { setSections(await fetchContentSections()); onChanged?.(); };

  useEffect(() => {
    (async () => {
      try {
        const [secs, t] = await Promise.all([fetchContentSections(), loadAttributeTree()]);
        setSections(secs); setTree(t);
      } catch (e) { console.error("セクション読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  const openEdit = (s: ContentSection) => { setEdit({ ...s }); setPublishAll(!!s.id && s.attrIds.length === 0); };

  const move = async (idx: number, dir: number) => {
    const to = idx + dir;
    if (to < 0 || to >= sorted.length) return;
    const arr = [...sorted];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((s, i) => ({ id: s.id, sortOrder: i }));
    setSections((prev) => prev.map((s) => { const u = updates.find((x) => x.id === s.id); return u ? { ...s, sortOrder: u.sortOrder } : s; }));
    await saveSectionOrder(updates);
    onChanged?.();
  };

  const togglePub = async (s: ContentSection) => {
    await setSectionPublished(s.id, !s.published);
    setSections((prev) => prev.map((x) => x.id === s.id ? { ...x, published: !x.published } : x));
    onChanged?.();
  };

  const doSave = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error("セクション名を入力してください"); return; }
    if (!publishAll && edit.attrIds.length === 0) { toast.error("公開対象の属性を指定するか「全員に公開」にしてください"); return; }
    const res = await saveSection(edit);
    if (res.id == null) { toast.error(res.error ?? "保存できませんでした"); return; }
    toast.success("保存しました");
    setEdit(null);
    await reload();
  };

  const doDelete = async () => {
    if (!edit || !edit.id) return;
    if (edit.isDefault) { toast.error("既定セクションは削除できません"); return; }
    const n = pageCount(edit.id);
    const ok = await confirm({
      title: "セクションを削除",
      message: n > 0
        ? `このセクションには ${n} 件のページが所属しています。削除するとサイドバーから消えます（ページは残りますが、別セクションへ移すまで会員から見えなくなります）。よろしいですか？`
        : "このセクションを削除します。よろしいですか？",
      confirmLabel: "削除する", danger: true,
    });
    if (!ok) return;
    const res = await deleteSection(edit.id);
    if (!res.ok) { toast.error(res.error ?? "削除できませんでした"); return; }
    toast.success("削除しました");
    setEdit(null);
    await reload();
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="grid" size={18} /></span>
        <p className="leading-relaxed m-0">
          <b className="text-red-600">セクション</b>＝会員ポータルの「コンテンツ入口」です。増やすとサイドバーに入口（コンテンツ2・3…）が増えます。
          各ページは「ページ管理」→ページ編集の<b>所属セクション</b>で振り分けます。
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-bold text-gray-700">セクション一覧</span>
          <span className="flex-1" />
          <button onClick={() => openEdit(newSection(sections.length))}
            className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
            <span className="text-base leading-none">＋</span>セクションを追加
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-gray-300 py-12 text-sm">セクションがありません</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sorted.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[11px] leading-none">▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === sorted.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[11px] leading-none mt-0.5">▼</button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-800 truncate">{s.name || "（無題）"}</span>
                    {s.isDefault && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">既定</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400">{pageCount(s.id)}ページ</span>
                    <AttrChips index={index} ids={s.attrIds} mode={s.attrIds.length ? s.attrMode : undefined} emptyLabel="全員" />
                  </div>
                </div>
                {/* 公開トグル */}
                <button onClick={() => togglePub(s)} title={s.published ? "公開中" : "非公開"}
                  className={`relative w-10 h-[21px] rounded-full shrink-0 ${s.published ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${s.published ? "left-[21px]" : "left-0.5"}`} />
                </button>
                <button onClick={() => openEdit(s)}
                  className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">編集</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 編集モーダル */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <span className="text-base font-bold">{edit.id ? "セクションを編集" : "セクションを追加"}</span>
              <span className="flex-1" />
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">セクション名 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">サイドバー・ハブ見出しに表示</span></label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="例：講座 / 特典 / コンテンツ2" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">概要 <span className="text-gray-400 font-normal">任意・ハブ上部に表示</span></label>
                <textarea className={`${input} min-h-[64px]`} value={edit.overview} onChange={(e) => setEdit({ ...edit, overview: e.target.value })} placeholder="この入口の説明（例：受講生向けの講座をまとめています）" />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">公開対象 <span className="text-gray-400 font-normal">この入口を誰に見せるか</span></label>
                <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${publishAll ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600" checked={publishAll}
                    onChange={(e) => { const on = e.target.checked; setPublishAll(on); if (on) setEdit({ ...edit, attrIds: [] }); }} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${publishAll ? "text-emerald-800" : "text-gray-700"}`}>全員に公開する</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${publishAll ? "text-emerald-700" : "text-gray-500"}`}>属性の指定なしで、全会員のサイドバーに入口を出します。</span>
                  </span>
                </label>
                {!publishAll && (
                  <div className="mt-2.5">
                    <AttrTable tree={tree} index={index} value={edit.attrIds}
                      onChange={(ids) => setEdit({ ...edit, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
                    <div className="mt-2">
                      <label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                      <select className={`${input} bg-white`} value={edit.attrMode} onChange={(e) => setEdit({ ...edit, attrMode: e.target.value as PublishMode })}>
                        {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select>
                    </div>
                    {edit.attrIds.length === 0 && (
                      <p className="text-[11px] text-red-600 mt-1.5">⚠ 属性を1つ以上指定するか、「全員に公開する」にチェックしてください</p>
                    )}
                  </div>
                )}
              </div>

              {edit.isDefault && (
                <p className="text-[11px] text-gray-400">これは既定セクションです（削除不可。所属セクション未設定のページの受け皿になります）。</p>
              )}
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {edit.id && !edit.isDefault ? (
                <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button>
              ) : null}
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
