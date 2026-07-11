"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { errMessage } from "../../lib/errors";
import { apiFetch } from "../../lib/apiClient";
import { useMaster } from "../../hooks/useMaster";
import type { Member, Template } from "../../lib/models";
import { MemberPicker } from "./MemberPicker";
import { IdHelpLink } from "./IdHelpLink";
import { ProjectNotifySettings } from "./ProjectNotifySettings";
import type { ProjectForm, NotifyOverrides } from "./formTypes";

export interface ProjectFormFieldsProps {
  form: ProjectForm;
  setForm: Dispatch<SetStateAction<ProjectForm>>;
  members: Member[];
  templates?: Template[];
}

type TestState = "sending" | { ok: boolean; msg: string } | null;

export function ProjectFormFields({ form, setForm, members, templates }: ProjectFormFieldsProps) {
  const { can } = useMaster();
  const ICLS = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
  const set  = (patch: Partial<ProjectForm>) => setForm((f) => ({ ...f, ...patch }));
  const cpNums = ["①", "②", "③"];
  const fRec = form as Record<string, string | undefined>;

  const [testState, setTestState] = useState<TestState>(null);
  const sendTestNotify = async () => {
    const room = (form.notifyChat ?? "").trim();
    if (!room) { setTestState({ ok: false, msg: "通知先を入力してください" }); return; }
    setTestState("sending");
    try {
      const res = await apiFetch("/api/chatwork/test", {
        method: "POST",
        body: {
          room,
          message: `[info][title]✅ KAWAI CAMP テスト通知[/title]「${form.name || "（プロジェクト名未入力）"}」の通知設定は正常です。[/info]`,
        },
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "送信に失敗しました");
      setTestState({ ok: true, msg: "テスト通知を送信しました" });
    } catch (err) {
      setTestState({ ok: false, msg: errMessage(err) });
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">プロジェクト名 <span className="text-red-500">*</span></label>
          <input className={ICLS} value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="プロジェクト名" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">プロジェクト略称 <span className="text-red-500">*</span></label>
          <input className={ICLS} value={form.abbreviation ?? ""} onChange={(e) => set({ abbreviation: e.target.value })} placeholder="例：WLF" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">開始日</label>
          <input type="date" className={ICLS} value={form.startDate || ""} onChange={(e) => set({ startDate: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">期限日 <span className="text-red-500">*</span></label>
          <input type="date" className={ICLS} value={form.dueDate || ""} onChange={(e) => set({ dueDate: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">クローズ日</label>
          <input type="date" className={ICLS} value={form.closeDate || ""} onChange={(e) => set({ closeDate: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1.5">チェックポイント（要確認日）</label>
        {[1, 2, 3].map((n) => (
          <div key={n} className="grid gap-2 items-center mb-1.5" style={{ gridTemplateColumns: "28px 1fr 150px" }}>
            <span className="w-7 h-7 rounded-full bg-red-100 text-red-700 text-xs font-medium flex items-center justify-center">{cpNums[n - 1]}</span>
            <input className={ICLS} value={fRec[`checkpoint${n}Name`] ?? ""} onChange={(e) => set({ [`checkpoint${n}Name`]: e.target.value } as Partial<ProjectForm>)} placeholder="名称（例：中間レビュー）" />
            <input type="date" className={ICLS} value={fRec[`checkpoint${n}Date`] || ""} onChange={(e) => set({ [`checkpoint${n}Date`]: e.target.value } as Partial<ProjectForm>)} />
          </div>
        ))}
      </div>

      {can("chatwork") && (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">通知先（ChatWork ルーム）</label>
          <IdHelpLink img="/help/chatwork_id_room.png" title="グループチャットID（ルームID）の調べ方" label="ルームIDの調べ方（PDF）" />
        </div>
        <div className="flex gap-2">
          <input className={ICLS} value={form.notifyChat ?? ""} onChange={(e) => { set({ notifyChat: e.target.value }); setTestState(null); }}
            placeholder="ChatWork ルームID または ルームURL（例: 123456789）" />
          <button type="button" onClick={sendTestNotify} disabled={testState === "sending"}
            className="shrink-0 px-3 py-2 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-blue-50 disabled:opacity-40 whitespace-nowrap">
            {testState === "sending" ? "送信中…" : "テスト送信"}
          </button>
        </div>
        {testState && testState !== "sending" && (
          <p className={`text-xs mt-1 ${testState.ok ? "text-green-600" : "text-red-500"}`}>{testState.msg}</p>
        )}
      </div>
      )}

      <div>
        <label className="text-xs text-gray-500 block mb-1">関連メンバー <span className="text-red-500">*</span></label>
        <MemberPicker selected={form.memberNames ?? []} onChange={(names) => set({ memberNames: names })} members={members} />
        {(form.memberNames ?? []).length === 0 && (
          <p className="text-xs text-red-500 mt-1">メンバーを1名以上選択してください</p>
        )}
      </div>

      {!form.id && templates && templates.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">テンプレートを適用（任意）</label>
          <select className={`${ICLS} bg-white`} value={form.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— 適用しない —</option>
            {templates.map((t) => <option key={t.id} value={t.id ?? ""}>{t.name}</option>)}
          </select>
          {form.templateId && !form.startDate && (
            <p className="text-xs text-orange-500 mt-1">テンプレートを適用するには開始日が必要です</p>
          )}
        </div>
      )}

      {can("chatwork") && (
        <ProjectNotifySettings overrides={form.notifyOverrides} onChange={(ov: NotifyOverrides) => set({ notifyOverrides: ov })} />
      )}
    </>
  );
}
