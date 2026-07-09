"use client";
import {
  VARS_GLOBAL, VARS_TASKLINE, VARS_CPLINE, resolveTextField,
  type NotifyCategory, type TemplateField, type TextOverride,
} from "../../lib/notifyCategories";
import { buildNotifyPreview } from "../../lib/notifyPreview";
import type { NotifyValues } from "./formTypes";

export interface NotifyTemplateEditorProps {
  cat: NotifyCategory;
  values: NotifyValues;
  fallback?: NotifyValues;
  onChange: (v: NotifyValues) => void;
}

// 通知文面エディタ（見出し／前文／タスク行／末尾の4パート＋プレビュー）
export function NotifyTemplateEditor({ cat, values, fallback = {}, onChange }: NotifyTemplateEditorProps) {
  const lineVars = cat.unit === "projectCp" ? VARS_CPLINE : VARS_TASKLINE;
  const TA = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-red-400";
  const ph = (field: TemplateField): string =>
    resolveTextField(field, cat.defaults[field], null, fallback as TextOverride);
  const VarChips = ({ vars }: { vars: string[] }) => (
    <div className="flex flex-wrap gap-1 mt-1">
      <span className="text-[10px] text-gray-400 self-center">差込変数:</span>
      {vars.map((v) => <code key={v} className="text-[10px] bg-blue-50 text-red-600 px-1.5 py-0.5 rounded">{v}</code>)}
    </div>
  );
  const Field = ({ label, field, vars, rows = 1 }: { label: string; field: TemplateField; vars: string[]; rows?: number }) => (
    <div className="mb-2">
      <label className="text-[11px] text-gray-500 block mb-0.5">{label}</label>
      <textarea rows={rows} className={TA} value={values[field] ?? ""}
        placeholder={ph(field) || "（未設定）"}
        onChange={(e) => onChange({ ...values, [field]: e.target.value })} />
      <VarChips vars={vars} />
    </div>
  );
  return (
    <div className="bg-gray-50 rounded-lg p-2.5 mt-1">
      <Field label="① 見出し" field="header" vars={VARS_GLOBAL} />
      <Field label="② 本文・前文（任意）" field="lead" vars={VARS_GLOBAL} rows={2} />
      <div className="mb-2">
        <label className="text-[11px] text-gray-500 block mb-0.5">③ タスク行テンプレート（件数ぶん繰り返し）</label>
        <textarea rows={1} className={TA} value={values.taskLine ?? ""}
          placeholder={ph("taskLine")}
          onChange={(e) => onChange({ ...values, taskLine: e.target.value })} />
        <VarChips vars={lineVars} />
        <p className="text-[10px] text-orange-500 mt-0.5">※ タスク単位の変数は前文・末尾では使えません</p>
      </div>
      <Field label="④ 本文・末尾文（任意）" field="tail" vars={VARS_GLOBAL} rows={2} />
      <div className="border-t border-dashed border-gray-200 pt-2 mt-1">
        <p className="text-[11px] text-green-600 mb-1">👁 プレビュー</p>
        <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-sans m-0 bg-green-50 rounded p-2">{buildNotifyPreview(cat, fallback as TextOverride, values as TextOverride)}</pre>
      </div>
    </div>
  );
}
