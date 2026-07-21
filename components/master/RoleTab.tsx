"use client";
// ============================================================
// ロールマスタ（roles）
//
//   システム固定ロール（管理者 / オペレーター / メンバー / 外部）は
//   編集・削除不可。追加できるのは「オペレーターの派生ロール」のみ。
//
//   ★派生ロールのデータ参照範囲は派生元（オペレーター）と同一。
//     機能の表示 / 利用可否は［権限］タブ（role_permissions）で絞る。
//
//   ⚠️ 作成時は必ず権限の初期値を投入する（既定＝オペレーターからコピー）。
//      投入しないと canFor() が全て false に倒れ、
//      「ログインしても何も表示されないロール」になる。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../common/Icon";
import { useToast } from "../common/ToastProvider";
import { useConfirm } from "../common/ConfirmProvider";
import {
  allRoles, loadRoles, createDerivedRole, updateRole, deleteRole,
  copyRolePermissions, countMembersByRole, BASE_ROLE,
} from "../../lib/roles";
import type { RoleDef } from "../../lib/roles";

import { FIELD_INPUT } from "../../lib/constants";
interface Props {
  /** ロール構成が変わったら親に知らせる（権限表の列を作り直すため） */
  onRolesChanged?: () => void;
}

type EditState = { key: string; label: string; sortOrder: number } | null;
type NewState  = { key: string; sortOrder: number; copyPerms: boolean } | null;

export function RoleTab({ onRolesChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();

  const [roles, setRoles]   = useState<RoleDef[]>(allRoles());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy]     = useState(false);
  const [edit, setEdit]     = useState<EditState>(null);
  const [adding, setAdding] = useState<NewState>(null);

  const refresh = useCallback(async () => {
    const [rs, cs] = await Promise.all([loadRoles(), countMembersByRole()]);
    setRoles(rs);
    setCounts(cs);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 表示順：派生ロールは派生元（オペレーター）の直下に並べる
  const ordered = useMemo(() => {
    const systems = roles.filter((r) => r.isSystem).sort((a, b) => a.sortOrder - b.sortOrder);
    const derived = roles.filter((r) => !r.isSystem).sort((a, b) => a.sortOrder - b.sortOrder);
    const out: RoleDef[] = [];
    for (const s of systems) {
      out.push(s);
      if (s.key === BASE_ROLE) out.push(...derived.filter((d) => d.baseRole === s.key));
    }
    // 念のため：派生元が見つからなかったものを末尾に
    for (const d of derived) if (!out.includes(d)) out.push(d);
    return out;
  }, [roles]);

  const nextSort = useMemo(() => {
    const base = roles.find((r) => r.key === BASE_ROLE)?.sortOrder ?? 20;
    const used = roles.filter((r) => !r.isSystem).map((r) => r.sortOrder);
    return used.length > 0 ? Math.max(...used) + 1 : base + 1;
  }, [roles]);

  // ── 作成 ──────────────────────────────────────────────────
  const submitNew = async () => {
    if (!adding) return;
    const key = adding.key.trim();
    if (!key) { toast.error("ロール名を入力してください"); return; }
    if (roles.some((r) => r.key === key)) { toast.error("同じ名前のロールが既にあります"); return; }

    setBusy(true);
    const created = await createDerivedRole({ key, sortOrder: adding.sortOrder });
    if (!created.ok) {
      setBusy(false);
      // 原因を握り潰さず DB のメッセージを見せる。
      //   42501 = RLS 拒否（管理者ロールとして認識されていない）
      //   23505 = キー重複 / 23514 = CHECK 違反 / PGRST205 = スキーマ未反映
      toast.error(`ロールを作成できません: ${created.message}`);
      return;
    }
    if (adding.copyPerms) {
      const copied = await copyRolePermissions(BASE_ROLE, key);
      if (!copied.ok) toast.error(`権限の初期値コピーに失敗: ${copied.message}`);
    }
    setBusy(false);
    setAdding(null);
    await refresh();
    onRolesChanged?.();
    toast.success(`ロール「${key}」を作成しました`);
  };

  // ── 更新 ──────────────────────────────────────────────────
  const submitEdit = async () => {
    if (!edit) return;
    setBusy(true);
    const ok = await updateRole(edit.key, { label: edit.label, sortOrder: edit.sortOrder });
    setBusy(false);
    if (!ok) { toast.error("保存できません（管理者権限、またはロールマスタの状態を確認してください）"); return; }
    setEdit(null);
    await refresh();
    onRolesChanged?.();
    toast.success("保存しました");
  };

  // ── 削除 ──────────────────────────────────────────────────
  const remove = async (r: RoleDef) => {
    const n = counts[r.key] ?? 0;
    if (n > 0) { toast.error(`「${r.key}」は${n}名が使用中のため削除できません`); return; }

    const ok = await confirm({
      title: `ロール「${r.key}」を削除しますか？`,
      message: "このロールの権限設定もあわせて削除されます。この操作は取り消せません。",
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    const done = await deleteRole(r.key);
    setBusy(false);
    if (!done.ok) { toast.error(`削除できません: ${done.message}`); return; }
    await refresh();
    onRolesChanged?.();
    toast.success("削除しました");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        ロールの追加・編集・削除を行います（管理者のみ操作可）。追加できるのは「{BASE_ROLE}」の派生ロールのみです。
        システム固定ロール（管理者・{BASE_ROLE}・メンバー・外部）は編集・削除できません。<br />
        派生ロールが参照できるデータの範囲は {BASE_ROLE} と同じです。各機能の表示 / 利用可否は
        <span className="text-red-500 font-bold">［権限］</span>タブで設定してください。
      </p>

      <div className="flex justify-end">
        <button
          onClick={() => setAdding({ key: "", sortOrder: nextSort, copyPerms: true })}
          className="text-xs font-bold text-white bg-red-500 border border-red-500 rounded-lg px-3 py-1.5 hover:opacity-90">
          ＋ ロールを追加
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="tbl-head">
              <th className="text-left font-medium px-4 py-2.5 min-w-[170px]">ロール名</th>
              <th className="text-left font-medium px-3 py-2.5 w-[90px]">種別</th>
              <th className="text-left font-medium px-3 py-2.5 w-[130px]">派生元</th>
              <th className="text-center font-medium px-3 py-2.5 w-[90px]">使用中</th>
              <th className="text-center font-medium px-3 py-2.5 w-[80px]">並び順</th>
              <th className="text-left font-medium px-3 py-2.5 w-[150px]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {ordered.map((r) => {
              const used = counts[r.key] ?? 0;
              const derived = !r.isSystem;
              return (
                <tr key={r.key} className={derived ? "bg-violet-50/30" : "hover:bg-gray-50/60"}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {derived && <span className="text-violet-300 text-xs">└</span>}
                      <span className={`text-[11.5px] font-bold border rounded-full px-2 py-0.5 ${
                        r.key === "管理者"   ? "bg-red-50 text-red-600 border-red-200" :
                        r.key === BASE_ROLE  ? "bg-blue-50 text-blue-600 border-blue-200" :
                        r.key === "外部"     ? "bg-gray-50 text-gray-500 border-gray-200" :
                        derived              ? "bg-violet-50 text-violet-600 border-violet-200" :
                                               "bg-green-50 text-green-600 border-green-200"}`}>
                        {r.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10.5px] font-bold border rounded-full px-2 py-0.5 ${
                      derived ? "bg-violet-50 text-violet-600 border-violet-200"
                              : "bg-gray-50 text-gray-400 border-gray-200"}`}>
                      {derived ? "派生" : "固定"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{r.baseRole ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-gray-600">
                    {used > 0 ? `${used}名` : <span className="text-gray-300">0名</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-gray-400">{r.sortOrder}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1.5">
                      <button
                        disabled={r.isSystem || busy}
                        onClick={() => setEdit({ key: r.key, label: r.label, sortOrder: r.sortOrder })}
                        title={r.isSystem ? "システム固定ロールは編集できません" : "編集"}
                        className="text-[11px] font-bold text-gray-500 border border-gray-200 bg-white rounded-md px-2 py-1
                                   enabled:hover:border-red-300 enabled:hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                        編集
                      </button>
                      <button
                        disabled={r.isSystem || used > 0 || busy}
                        onClick={() => void remove(r)}
                        title={
                          r.isSystem ? "システム固定ロールは削除できません"
                          : used > 0 ? `${used}名が使用中のため削除できません`
                          : "削除"}
                        className="text-[11px] font-bold text-gray-500 border border-gray-200 bg-white rounded-md px-2 py-1
                                   enabled:hover:border-red-300 enabled:hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        ロール名は登録後に変更できません（メンバーと権限設定から参照されているため）。表示名と並び順のみ編集できます。
      </p>

      {/* ── 追加モーダル ────────────────────────────────── */}
      {adding && (
        <Modal title="ロールを追加" onClose={() => setAdding(null)}>
          <div className="space-y-3.5">
            <Field label="ロール名" required
              hint="メンバー一覧のバッジや権限表の見出しに表示されます。登録後は変更できません。">
              <input autoFocus value={adding.key}
                onChange={(e) => setAdding((v) => v ? { ...v, key: e.target.value } : v)}
                placeholder="例：ホルダー"
                className={FIELD_INPUT} />
            </Field>

            <Field label="派生元" hint={`データの参照範囲は ${BASE_ROLE} と同じになります。`}>
              <select disabled value={BASE_ROLE}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400">
                <option>{BASE_ROLE}（固定）</option>
              </select>
            </Field>

            <Field label="並び順">
              <input type="number" value={adding.sortOrder}
                onChange={(e) => setAdding((v) => v ? { ...v, sortOrder: Number(e.target.value) } : v)}
                className={`${FIELD_INPUT} !w-[120px]`} />
            </Field>

            <Field label="権限の初期値">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2.5">
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="radio" name="initperm" className="mt-0.5" checked={adding.copyPerms}
                    onChange={() => setAdding((v) => v ? { ...v, copyPerms: true } : v)} />
                  <span>
                    <b className="text-gray-700">{BASE_ROLE}の現在の設定をコピーする</b><br />
                    <span className="text-gray-400">作成後、［権限］タブで不要な機能をOFFにして調整します。</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="radio" name="initperm" className="mt-0.5" checked={!adding.copyPerms}
                    onChange={() => setAdding((v) => v ? { ...v, copyPerms: false } : v)} />
                  <span>
                    <span className="text-gray-700">すべてOFFで作成する</span><br />
                    <span className="text-gray-400">必要な機能を1つずつONにしていきます。</span>
                  </span>
                </label>
              </div>
            </Field>
          </div>

          <ModalFooter busy={busy} onCancel={() => setAdding(null)} onSubmit={submitNew} submitLabel="作成する" />
        </Modal>
      )}

      {/* ── 編集モーダル ────────────────────────────────── */}
      {edit && (
        <Modal title={`ロール「${edit.key}」を編集`} onClose={() => setEdit(null)}>
          <div className="space-y-3.5">
            <Field label="ロール名（変更不可）">
              <input disabled value={edit.key}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400" />
            </Field>
            <Field label="表示名" required>
              <input autoFocus value={edit.label}
                onChange={(e) => setEdit((v) => v ? { ...v, label: e.target.value } : v)}
                className={FIELD_INPUT} />
            </Field>
            <Field label="並び順">
              <input type="number" value={edit.sortOrder}
                onChange={(e) => setEdit((v) => v ? { ...v, sortOrder: Number(e.target.value) } : v)}
                className={`${FIELD_INPUT} !w-[120px]`} />
            </Field>
          </div>
          <ModalFooter busy={busy} onCancel={() => setEdit(null)} onSubmit={submitEdit} submitLabel="保存" />
        </Modal>
      )}
    </div>
  );
}

// ── 小物 ─────────────────────────────────────────────────────
function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ busy, onCancel, onSubmit, submitLabel }: {
  busy: boolean; onCancel: () => void; onSubmit: () => void; submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
      <button onClick={onCancel} disabled={busy}
        className="text-xs font-bold text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-300">
        キャンセル
      </button>
      <button onClick={onSubmit} disabled={busy}
        className="text-xs font-bold text-white bg-red-500 border border-red-500 rounded-lg px-4 py-2 hover:opacity-90 disabled:opacity-50">
        {submitLabel}
      </button>
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-500 text-[10px] ml-1">必須</span>}
      </label>
      {children}
      {hint && <p className="text-[10.5px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
