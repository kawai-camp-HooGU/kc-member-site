"use client";
import type { Dispatch, SetStateAction } from "react";
import type { Member, Project } from "../../lib/models";
import type { AnkenForm } from "./formTypes";
import { isStaffRole } from "../../lib/roles";
import { useMaster } from "../../hooks/useMaster";
import { statusOptions } from "../../lib/phaseStatus";

import { FIELD_INPUT } from "../../lib/constants";
export interface AnkenFormFieldsProps {
  form: AnkenForm;
  setForm: Dispatch<SetStateAction<AnkenForm>>;
  members: Member[];
  projects: Project[];
}

export function AnkenFormFields({ form, setForm, members, projects }: AnkenFormFieldsProps) {
  const { phaseStatuses } = useMaster();
  const ICLS = FIELD_INPUT;
  const SCLS = ICLS + " bg-white";
  const set  = (patch: Partial<AnkenForm>) => setForm((f) => ({ ...f, ...patch }));
  // 責任者候補は運営スタッフ（管理者・オペレーター・その派生ロール）
  const leaders = members.filter((m) => !m.isDeleted && isStaffRole(m.role));
  const leaderNames = leaders.map((m) => m.name);
  const showCurrent = form.leader && !leaderNames.includes(form.leader);
  // 選択中プロジェクトの区分に紐づくステータス（区分専用 → 共通 の順）
  const phaseCategoryId = projects.find((p) => p.id === form.projectId)?.categoryId ?? null;
  const phaseOptions = statusOptions(phaseStatuses, phaseCategoryId);
  return (
    <>
      <div>
        <label className="text-xs text-gray-500 block mb-1">プロジェクト</label>
        <select className={SCLS} value={form.projectId ?? ""} onChange={(e) => set({ projectId: Number(e.target.value) })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">フェーズ名 <span className="text-red-500">*</span></label>
          <input className={ICLS} value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="フェーズ名" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">フェーズ名略称</label>
          <input className={ICLS} value={form.abbreviation ?? ""} onChange={(e) => set({ abbreviation: e.target.value })} placeholder="例：共通" />
        </div>
      </div>

      {/* 進捗ステータス。選択肢は「そのPJの区分専用 ＋ 共通」。 */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">進捗ステータス</label>
        <select className={SCLS} value={form.statusId ?? ""}
          onChange={(e) => set({ statusId: e.target.value === "" ? null : Number(e.target.value) })}>
          <option value="">（未設定＝既定のステータス）</option>
          {phaseOptions.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}{st.scope === "category" ? "（区分専用）" : ""}{st.isDone ? "（完了扱い）" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">リーダー</label>
          <select className={SCLS} value={form.leader ?? ""} onChange={(e) => set({ leader: e.target.value })}>
            <option value="">リーダーを選択…</option>
            {showCurrent && <option value={form.leader ?? ""}>{form.leader}（現在値）</option>}
            {leaders.map((m) => <option key={m.name} value={m.name}>{m.name}（{m.role}）</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">期限日</label>
          <input type="date" className={ICLS} value={form.dueDate || ""} onChange={(e) => set({ dueDate: e.target.value })} />
        </div>
      </div>
    </>
  );
}
