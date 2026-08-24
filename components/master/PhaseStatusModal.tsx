"use client";
// ============================================================
// フェーズ進捗ステータスマスタ（設定 ＞ フェーズ ＞ 進捗ステータス編集）
//
//   左＝スコープ（共通／区分ごと）、右＝そのスコープのステータス一覧。
//   フェーズの選択肢は「区分専用 ＋ 共通」。区分なしのプロジェクトは共通のみ。
//
//   ⚠️ 既定は各スコープで1件だけ（DB側にも部分ユニークインデックスがある）。
//      画面でラジオを付け替えたら、同スコープの他の行は自動で外す。
//   ⚠️ 「完了扱い」はフェーズ一覧の『完了を除外』とガントの完了フィルタが見る。
//      名前が「完了」でもこのフラグが立っていなければ完了とは扱わない。
// ============================================================
import { useState } from "react";
import { supabase, fromPhaseStatus, toPhaseStatus } from "../../lib/supabase";
import { useMaster } from "../../hooks/useMaster";
import { useToast } from "../common/ToastProvider";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { FIELD_INPUT, PHASE_STATUS_COLORS, PHASE_STATUS_COLOR_DEFAULT } from "../../lib/constants";
import type { PhaseStatus, PhaseStatusScope } from "../../lib/models";

export interface PhaseStatusModalProps {
  onClose: () => void;
}

/** 左ナビのスコープ1件ぶん */
interface ScopeItem { key: string; label: string; scope: PhaseStatusScope; categoryId: number | null; color: string | null }

export function PhaseStatusModal({ onClose }: PhaseStatusModalProps) {
  const { phaseStatuses, setPhaseStatuses, projectCategories, anken, setAnken } = useMaster();
  const toast = useToast();

  const scopes: ScopeItem[] = [
    { key: "common", label: "共通", scope: "common", categoryId: null, color: null },
    ...projectCategories.filter((c) => !c.isDeleted).map((c) => ({
      key: `cat-${c.id}`, label: `区分：${c.name}`, scope: "category" as const, categoryId: c.id, color: c.color,
    })),
  ];
  const [scopeKey, setScopeKey] = useState<string>("common");
  const cur = scopes.find((s) => s.key === scopeKey) ?? scopes[0]!;

  // 編集中の行（保存を押すまで DB に書かない）
  const inScope = (s: PhaseStatus) =>
    !s.isDeleted && s.scope === cur.scope && (cur.scope === "common" || s.categoryId === cur.categoryId);
  const [draft, setDraft] = useState<PhaseStatus[] | null>(null);
  const rows = (draft ?? phaseStatuses.filter(inScope)).slice().sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));

  const [confirm, setConfirm] = useState<PhaseStatus | null>(null);
  const [saving, setSaving]   = useState(false);

  /** スコープを切り替えたら編集中の内容は破棄する（未保存のまま持ち越さない） */
  const switchScope = (k: string) => { setDraft(null); setScopeKey(k); };

  const patch = (id: number, p: Partial<PhaseStatus>) =>
    setDraft(rows.map((r) => r.id === id ? { ...r, ...p } : r));

  /** 既定は1件だけ。付け替えたら他は外す */
  const setDefault = (id: number) =>
    setDraft(rows.map((r) => ({ ...r, isDefault: r.id === id })));

  const move = (id: number, dir: -1 | 1) => {
    const i = rows.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const next = rows.slice();
    const a = next[i]!, b = next[j]!;
    next[i] = { ...a, sortOrder: b.sortOrder };
    next[j] = { ...b, sortOrder: a.sortOrder };
    setDraft(next.sort((x, y) => (x.sortOrder - y.sortOrder) || (x.id - y.id)));
  };

  const addRow = () => {
    // 未保存の新規行は負の仮IDで区別する（保存時に insert へ回す）
    const tmpId = Math.min(0, ...rows.map((r) => r.id)) - 1;
    const sortOrder = Math.max(0, ...rows.map((r) => r.sortOrder)) + 10;
    setDraft([...rows, {
      id: tmpId, scope: cur.scope, categoryId: cur.categoryId, name: "",
      color: PHASE_STATUS_COLOR_DEFAULT, isDefault: rows.length === 0, isDone: false,
      sortOrder, isDeleted: false,
    }]);
  };

  const save = async () => {
    if (saving) return;
    const target = rows.filter((r) => r.name.trim());
    setSaving(true);
    try {
      // ⚠️ 既定の付け替えは「既存を外してから新しいものを立てる」順で書く。
      //    先に立てると部分ユニークインデックス（uq_phase_statuses_default）に衝突する。
      const clearing = target.filter((r) => r.id > 0 && !r.isDefault);
      for (const r of clearing) {
        const { error } = await supabase.from("phase_statuses").update({ is_default: false }).eq("id", r.id);
        if (error) throw error;
      }
      const saved: PhaseStatus[] = [];
      for (const r of target) {
        if (r.id > 0) {
          const { error } = await supabase.from("phase_statuses").update(fromPhaseStatus(r)).eq("id", r.id);
          if (error) throw error;
          saved.push(r);
        } else {
          const { data, error } = await supabase.from("phase_statuses").insert(fromPhaseStatus(r)).select().single();
          if (error || !data) throw error ?? new Error("insert failed");
          saved.push(toPhaseStatus(data));
        }
      }
      setPhaseStatuses((prev) => [
        ...prev.filter((s) => !(s.scope === cur.scope && (cur.scope === "common" || s.categoryId === cur.categoryId))),
        ...saved,
      ]);
      setDraft(null);
      toast.success("保存しました");
    } catch (e) {
      console.error("進捗ステータスの保存エラー:", e);
      toast.error("保存に失敗しました（権限がない可能性があります）");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (st: PhaseStatus) => {
    setConfirm(null);
    if (st.id <= 0) { setDraft(rows.filter((r) => r.id !== st.id)); return; }  // 未保存の行はその場で消すだけ
    try {
      const { error } = await supabase.from("phase_statuses").update({ is_deleted: true }).eq("id", st.id);
      if (error) throw error;
      setPhaseStatuses((prev) => prev.filter((s) => s.id !== st.id));
      // 使用中のフェーズは「未設定」に戻す（画面上は既定ステータスとして表示される）
      setAnken((prev) => prev.map((a) => a.statusId === st.id ? { ...a, statusId: null } : a));
      setDraft(null);
      toast.success("削除しました");
    } catch (e) {
      console.error("進捗ステータスの削除エラー:", e);
      toast.error("削除に失敗しました（権限がない可能性があります）");
    }
  };

  const usedCount = (id: number) => anken.filter((a) => a.statusId === id).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center md:items-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-800">フェーズ進捗ステータス編集</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* 左：スコープ */}
          <div className="w-48 shrink-0 border-r border-gray-100 overflow-y-auto p-2">
            <p className="text-[11px] font-semibold text-gray-400 px-2 py-1">スコープ</p>
            {scopes.map((s) => (
              <button key={s.key} onClick={() => switchScope(s.key)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  scopeKey === s.key ? "bg-red-600 text-white font-bold" : "text-gray-600 hover:bg-gray-50"}`}>
                {s.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />}
                <span className="text-sm truncate">{s.label}</span>
              </button>
            ))}
          </div>

          {/* 右：ステータス一覧 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-800">{cur.label} のステータス</p>
              <button onClick={addRow}
                className="text-sm py-1.5 px-3 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                ＋ ステータス追加
              </button>
            </div>

            <div className="space-y-2">
              {rows.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-10">
                  ステータスがありません。「＋ ステータス追加」から作成してください。
                </p>
              )}
              {rows.map((r, i) => (
                <div key={r.id} className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5">
                  {/* 色見本＋選択。見本は状態表示、選択は隣のプルダウンで行う（色だけのボタン列は横幅が足りない） */}
                  <span className="w-8 h-8 rounded-lg shrink-0 border border-black/5" style={{ backgroundColor: r.color }} />
                  <select value={r.color} onChange={(e) => patch(r.id, { color: e.target.value })}
                    aria-label="色" className={`${FIELD_INPUT} w-36 shrink-0 bg-white`}>
                    {PHASE_STATUS_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input className={`${FIELD_INPUT} flex-1 min-w-0`} maxLength={20} value={r.name}
                    onChange={(e) => patch(r.id, { name: e.target.value })} placeholder="ステータス名" />
                  <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0 cursor-pointer">
                    <input type="radio" checked={r.isDefault} onChange={() => setDefault(r.id)}
                      className="w-3.5 h-3.5 accent-red-600" />既定
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0 cursor-pointer" title="このステータスのフェーズを「完了」として扱う">
                    <input type="checkbox" checked={r.isDone} onChange={(e) => patch(r.id, { isDone: e.target.checked })}
                      className="w-3.5 h-3.5 accent-red-600" />完了扱い
                  </label>
                  <button onClick={() => move(r.id, -1)} disabled={i === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 shrink-0" aria-label="上へ">▲</button>
                  <button onClick={() => move(r.id, 1)} disabled={i === rows.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 shrink-0" aria-label="下へ">▼</button>
                  <button onClick={() => setConfirm(r)}
                    className="text-xs text-red-500 hover:text-red-700 px-1 shrink-0">削除</button>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-gray-400 mt-3">
              既定は各スコープで1件のみ。フェーズの選択肢＝「区分専用 ＋ 共通」。
              「完了扱い」を付けたステータスは、フェーズ一覧の『完了を除外』とガントの完了フィルタで完了として扱われます。
            </p>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 shrink-0 justify-end">
          <button onClick={onClose}
            className="text-sm py-2.5 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">閉じる</button>
          <button onClick={save} disabled={saving}
            className="text-sm py-2.5 px-6 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          message={`ステータス「${confirm.name || "（名称未設定）"}」を削除します。${
            confirm.id > 0 && usedCount(confirm.id) > 0 ? `\nこのステータスを使っているフェーズ ${usedCount(confirm.id)} 件は「未設定」に戻ります。` : ""
          }`}
          onCancel={() => setConfirm(null)} onConfirm={() => remove(confirm)} />
      )}
    </div>
  );
}
