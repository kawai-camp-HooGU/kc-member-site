"use client";
// ============================================================
// プロジェクト区分マスタ（設定 ＞ プロジェクト ＞ サブマスタ ＞ 区分を編集）
//
//   左＝区分の一覧／右＝選択中の区分の編集。運営の権限マスタと同じ2ペイン。
//   ⚠️ 色は自由入力させない。CATEGORY_COLORS（赤の濃淡＋無彩色）からだけ選ばせる。
//      brand.md §1-1「多色は使わず、赤の濃淡で強弱を表現する」を画面で守るため。
//   ⚠️ 削除は論理削除。既にその区分を使っているプロジェクトは「区分なし」に戻る
//      （projects.category_id は on delete set null だが、論理削除では残るので画面側で除外）。
// ============================================================
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { fromProjectCategory, toProjectCategory } from "../../lib/supabase";
import { useMaster } from "../../hooks/useMaster";
import { useToast } from "../common/ToastProvider";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { FIELD_INPUT, CATEGORY_COLORS, CATEGORY_COLOR_DEFAULT, chipStyle } from "../../lib/constants";
import type { ProjectCategory } from "../../lib/models";

export interface ProjectCategoryModalProps {
  onClose: () => void;
}

/** 新規行のひな形（id は保存時に採番される） */
const blank = (sortOrder: number): ProjectCategory => ({
  id: 0, name: "", color: CATEGORY_COLOR_DEFAULT, note: "", sortOrder, isDeleted: false,
});

export function ProjectCategoryModal({ onClose }: ProjectCategoryModalProps) {
  const { projectCategories, setProjectCategories, projects, setProjects } = useMaster();
  const toast = useToast();
  const rows = projectCategories.filter((c) => !c.isDeleted);

  const [sel, setSel]         = useState<ProjectCategory | null>(rows[0] ?? null);
  const [confirm, setConfirm] = useState<ProjectCategory | null>(null);
  const [saving, setSaving]   = useState(false);

  const set = (patch: Partial<ProjectCategory>) => setSel((c) => c ? { ...c, ...patch } : c);

  const addNew = () => {
    const next = Math.max(0, ...rows.map((c) => c.sortOrder)) + 10;
    setSel(blank(next));
  };

  const save = async () => {
    if (!sel || !sel.name.trim() || saving) return;
    setSaving(true);
    try {
      if (sel.id) {
        const { error } = await supabase.from("project_categories").update(fromProjectCategory(sel)).eq("id", sel.id);
        if (error) throw error;
        setProjectCategories((prev) => prev.map((c) => c.id === sel.id ? sel : c));
      } else {
        const { data, error } = await supabase.from("project_categories").insert(fromProjectCategory(sel)).select().single();
        if (error || !data) throw error ?? new Error("insert failed");
        const saved = toProjectCategory(data);
        setProjectCategories((prev) => [...prev, saved]);
        setSel(saved);
      }
      toast.success("保存しました");
    } catch (e) {
      console.error("区分の保存エラー:", e);
      toast.error("保存に失敗しました（権限がない可能性があります）");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: ProjectCategory) => {
    try {
      const { error } = await supabase.from("project_categories").update({ is_deleted: true }).eq("id", c.id);
      if (error) throw error;
      setProjectCategories((prev) => prev.filter((x) => x.id !== c.id));
      // ⚠️ 論理削除では FK の set null が効かない。使用中のプロジェクトは手元で「区分なし」に戻す
      //    （DB側は次の保存で category_id=null が書かれる）。
      setProjects((prev) => prev.map((p) => p.categoryId === c.id ? { ...p, categoryId: null } : p));
      setSel(null);
      toast.success("削除しました");
    } catch (e) {
      console.error("区分の削除エラー:", e);
      toast.error("削除に失敗しました（権限がない可能性があります）");
    }
    setConfirm(null);
  };

  const usedCount = (id: number) => projects.filter((p) => p.categoryId === id).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center md:items-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-800">プロジェクト区分編集</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* 左：区分の一覧 */}
          <div className="w-52 shrink-0 border-r border-gray-100 flex flex-col">
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {rows.length === 0 && <p className="text-xs text-gray-400 px-2 py-6 text-center">区分がありません</p>}
              {rows.map((c) => (
                <button key={c.id} onClick={() => setSel(c)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    sel?.id === c.id ? "bg-red-50 text-red-700 font-semibold" : "text-gray-600 hover:bg-gray-50"}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-sm truncate">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="p-2 border-t border-gray-100">
              <button onClick={addNew}
                className="w-full text-sm py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-600 transition-colors">
                ＋ 区分を追加
              </button>
            </div>
          </div>

          {/* 右：編集 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {!sel ? (
              <p className="text-sm text-gray-400 text-center py-16">左の一覧から区分を選ぶか、「＋ 区分を追加」で作成してください。</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">区分名 <span className="text-red-500">*</span></label>
                  <input className={FIELD_INPUT} maxLength={30} value={sel.name}
                    onChange={(e) => set({ name: e.target.value })} placeholder="例：ホルダー開拓" />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1.5">色定義</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {CATEGORY_COLORS.map((c) => (
                      <button key={c.value} type="button" title={c.label} onClick={() => set({ color: c.value })}
                        className={`w-8 h-8 rounded-lg transition-all ${
                          sel.color === c.value ? "ring-2 ring-offset-2 ring-gray-400" : "hover:scale-105"}`}
                        style={{ backgroundColor: c.value }} />
                    ))}
                    <span className="ml-1 text-xs px-2 py-1 rounded-full font-bold" style={chipStyle(sel.color)}>
                      {sel.name || "区分名"}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    一覧の行頭バー・区分チップ・ガントのフェーズ帯で使う色です。赤の濃淡と無彩色から選びます。
                  </p>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">備考</label>
                  <input className={FIELD_INPUT} maxLength={120} value={sel.note}
                    onChange={(e) => set({ note: e.target.value })} placeholder="備考（任意）" />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">並び順</label>
                  <input type="number" className={`${FIELD_INPUT} w-32`} value={sel.sortOrder}
                    onChange={(e) => set({ sortOrder: Number(e.target.value) || 0 })} />
                  <p className="text-[11px] text-gray-400 mt-1">小さいほど上に出ます。</p>
                </div>

                {sel.id > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400 mb-2">
                      この区分を使っているプロジェクト：{usedCount(sel.id)} 件
                      {usedCount(sel.id) > 0 && "（削除すると「区分なし」に戻ります）"}
                    </p>
                    <button onClick={() => setConfirm(sel)}
                      className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">
                      この区分を削除
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 shrink-0 justify-end">
          <button onClick={onClose}
            className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">閉じる</button>
          <button onClick={save} disabled={!sel || !sel.name.trim() || saving}
            className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog message={`区分「${confirm.name}」を削除します。よろしいですか？`}
          onCancel={() => setConfirm(null)} onConfirm={() => remove(confirm)} />
      )}
    </div>
  );
}
