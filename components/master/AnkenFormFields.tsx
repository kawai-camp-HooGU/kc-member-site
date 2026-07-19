"use client";
import type { Dispatch, SetStateAction } from "react";
import type { Member, Project } from "../../lib/models";
import type { AnkenForm } from "./formTypes";
import { isStaffRole } from "../../lib/roles";

export interface AnkenFormFieldsProps {
  form: AnkenForm;
  setForm: Dispatch<SetStateAction<AnkenForm>>;
  members: Member[];
  projects: Project[];
}

export function AnkenFormFields({ form, setForm, members, projects }: AnkenFormFieldsProps) {
  const ICLS = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
  const SCLS = ICLS + " bg-white";
  const set  = (patch: Partial<AnkenForm>) => setForm((f) => ({ ...f, ...patch }));
  // 責任者候補は運営スタッフ（管理者・オペレーター・その派生ロール）
  const leaders = members.filter((m) => !m.isDeleted && isStaffRole(m.role));
  const leaderNames = leaders.map((m) => m.name);
  const showCurrent = form.leader && !leaderNames.includes(form.leader);
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
          <label className="text-xs text-gray-500 block mb-1">分類名 <span className="text-red-500">*</span></label>
          <input className={ICLS} value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="分類名" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">分類名略称</label>
          <input className={ICLS} value={form.abbreviation ?? ""} onChange={(e) => set({ abbreviation: e.target.value })} placeholder="例：共通" />
        </div>
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
