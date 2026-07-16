// ============================================================
// フォーム：DB行 ⇄ モデル変換 と 共通ロジック（純粋関数・supabase 非依存）
//   クライアント（lib/forms.ts）とサーバー（lib/formsServer.ts）の両方から使う
// ============================================================
import type { Tables } from "./database.types";
import type {
  FormAction, FormAnswer, FormDef, FormDesign, FormField, FormOption, FormSection,
  FieldCondition, FieldRule, FieldType, FormStatus, FormVisibility, SaveTarget, SubmissionStatus,
} from "./models";
import { DEFAULT_FORM_DESIGN, IS_DISPLAY_ONLY } from "./models";

// ── 変換：DB行 → モデル ───────────────────────────────────────
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function toDesign(v: unknown): FormDesign {
  const d = (v && typeof v === "object" ? v : {}) as Partial<FormDesign>;
  return {
    ...DEFAULT_FORM_DESIGN,
    ...d,
    // ご連絡先設定は入れ子なので、古いデータ（未設定）でも既定で埋める
    guestContact: { ...DEFAULT_FORM_DESIGN.guestContact, ...(d.guestContact ?? {}) },
  };
}

export function toCondition(v: unknown): FieldCondition | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<FieldCondition>;
  if (typeof c.fieldId !== "number") return null;
  return { fieldId: c.fieldId, op: c.op === "neq" ? "neq" : "eq", value: String(c.value ?? "") };
}

export function toOptions(v: unknown): FormOption[] {
  return asArray<Partial<FormOption>>(v).map((o) => ({
    label: String(o?.label ?? ""),
    actions: asArray<FormAction>(o?.actions),
  }));
}

export function toField(r: Tables<"form_fields">): FormField {
  return {
    id: r.id,
    type: (r.type as FieldType) ?? "text",
    label: r.label ?? "",
    description: r.description ?? "",
    placeholder: r.placeholder ?? "",
    defaultValue: r.default_value ?? "",
    required: r.required ?? false,
    rule: (r.rule as FieldRule) ?? "",
    minLen: r.min_len ?? "",
    maxLen: r.max_len ?? "",
    maxSelect: r.max_select ?? "",
    saveTo: (r.save_to as SaveTarget) ?? "",
    options: toOptions(r.options),
    condition: toCondition(r.condition),
    sortOrder: r.sort_order ?? 0,
  };
}

export function toSection(r: Tables<"form_sections">, fields: FormField[]): FormSection {
  return {
    id: r.id,
    name: r.name ?? "",
    condition: toCondition(r.condition),
    sortOrder: r.sort_order ?? 0,
    fields,
  };
}

export function toForm(r: Tables<"forms">, sections: FormSection[]): FormDef {
  return {
    id: r.id,
    name: r.name ?? "",
    folder: r.folder ?? "",
    slug: r.slug,
    title: r.title ?? "",
    description: r.description ?? "",
    status: (r.status as FormStatus) ?? "draft",
    visibility: (r.visibility as FormVisibility) ?? "both",
    deadlineAt: r.deadline_at ? r.deadline_at.slice(0, 16) : "",
    deadlineMessage: r.deadline_message ?? "",
    answerLimit: r.answer_limit ?? 1,
    confirmDialog: r.confirm_dialog ?? true,
    confirmText: r.confirm_text ?? "",
    thanksUrl: r.thanks_url ?? "",
    thanksText: r.thanks_text ?? "",
    design: toDesign(r.design),
    afterActions: asArray<FormAction>(r.after_actions),
    autofillMember: r.autofill_member ?? true,
    notifyEnabled: r.notify_enabled ?? false,
    showOnCalendar: r.show_on_calendar ?? false,
    calendarLabel: r.calendar_label ?? "",
    sections,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

/** セクション行＋設問行の配列から FormDef を組み立てる */
export function assembleForm(
  form: Tables<"forms">,
  sections: Tables<"form_sections">[],
  fields: Tables<"form_fields">[],
): FormDef {
  const secs = [...sections]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s) =>
      toSection(
        s,
        fields
          .filter((f) => f.section_id === s.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(toField),
      ),
    );
  return toForm(form, secs);
}

export function toAnswer(r: Tables<"form_answers">): FormAnswer {
  return {
    fieldId: r.field_id,
    label: r.label ?? "",
    value: r.value ?? "",
    valueList: asArray<string>(r.value_list),
    filePath: r.file_path ?? "",
  };
}

// ── 新規作成用のひな形 ────────────────────────────────────────
let tmp = -1;
/** 未保存の要素に割り当てる一時ID（負数） */
export const nextTempId = (): number => tmp--;

export function newField(type: FieldType = "text"): FormField {
  return {
    id: nextTempId(), type, label: "", description: "", placeholder: "", defaultValue: "",
    required: false, rule: "", minLen: "", maxLen: "", maxSelect: "", saveTo: "",
    options: ["radio", "checkbox", "select"].includes(type)
      ? [{ label: "選択肢1", actions: [] }, { label: "選択肢2", actions: [] }]
      : [],
    condition: null, sortOrder: 0,
  };
}

export function newSection(name = ""): FormSection {
  return { id: nextTempId(), name, condition: null, sortOrder: 0, fields: [] };
}

export function emptyForm(): FormDef {
  return {
    id: 0, name: "", folder: "", slug: "", title: "", description: "",
    status: "draft", visibility: "both",
    deadlineAt: "", deadlineMessage: "受付は終了しました。",
    answerLimit: 1, confirmDialog: true, confirmText: "この内容で送信します。よろしいですか？",
    thanksUrl: "", thanksText: "ご回答ありがとうございました。",
    design: { ...DEFAULT_FORM_DESIGN }, afterActions: [],
    autofillMember: true, notifyEnabled: false,
    showOnCalendar: false, calendarLabel: "",
    sections: [{ ...newSection("セクション1"), fields: [] }],
    createdAt: "", updatedAt: "",
  };
}

// ── slug ─────────────────────────────────────────────────────
export function slugify(s: string): string {
  const base = s.trim().toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー\- ]/g, "")
    .replace(/[\s　]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `form-${Date.now().toString(36)}`;
}

// ── 回答値のバリデーション ────────────────────────────────────
const RULE_RE: Record<FieldRule, RegExp> = {
  email:   /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  tel:     /^[0-9０-９\-+() ]{8,20}$/,
  zip:     /^[0-9]{3}-?[0-9]{4}$/,
  numeric: /^[0-9]+$/,
  kana:    /^[ぁ-んー\s　]+$/,
};
export const RULE_ERROR: Record<FieldRule, string> = {
  email:   "メールアドレスの形式で入力してください",
  tel:     "電話番号の形式で入力してください",
  zip:     "郵便番号の形式（1234567）で入力してください",
  numeric: "半角数字で入力してください",
  kana:    "ひらがなで入力してください",
};

/** 回答マップ（fieldId → 値）。checkbox は string[] */
export type AnswerMap = Record<number, string | string[]>;

/** 条件（分岐）を満たすか。条件なしは常に表示。 */
export function isVisible(cond: FieldCondition | null, answers: AnswerMap): boolean {
  if (!cond) return true;
  const v = answers[cond.fieldId];
  const list = Array.isArray(v) ? v : [String(v ?? "")];
  const hit = list.includes(cond.value);
  return cond.op === "eq" ? hit : !hit;
}

/** 1設問の検証。問題なければ "" を返す。 */
export function validateField(f: FormField, v: string | string[] | undefined): string {
  if (IS_DISPLAY_ONLY(f.type)) return "";
  const isArr = Array.isArray(v);
  const empty = isArr ? v.length === 0 : !String(v ?? "").trim();
  if (f.required && empty) return "必須項目です";
  if (empty) return "";

  if (isArr) {
    if (f.maxSelect !== "" && v.length > Number(f.maxSelect)) return `${f.maxSelect}つまで選択できます`;
    return "";
  }
  const s = String(v);
  if (f.rule && RULE_RE[f.rule as FieldRule] && !RULE_RE[f.rule as FieldRule].test(s)) {
    return RULE_ERROR[f.rule as FieldRule];
  }
  if (f.minLen !== "" && s.length < Number(f.minLen)) return `${f.minLen}文字以上で入力してください`;
  if (f.maxLen !== "" && s.length > Number(f.maxLen)) return `${f.maxLen}文字以内で入力してください`;
  if (f.type === "number" && !/^-?[0-9]+(\.[0-9]+)?$/.test(s)) return "数値を入力してください";
  return "";
}

/** フォーム全体の検証（表示中の設問のみ）。fieldId → エラー文 */
export function validateForm(form: FormDef, answers: AnswerMap): Record<number, string> {
  const errs: Record<number, string> = {};
  for (const sec of form.sections) {
    if (!isVisible(sec.condition, answers)) continue;
    for (const f of sec.fields) {
      if (!isVisible(f.condition, answers)) continue;
      const e = validateField(f, answers[f.id]);
      if (e) errs[f.id] = e;
    }
  }
  return errs;
}

/** 受付中か（公開・期限内） */
export function formIsOpen(form: Pick<FormDef, "status" | "deadlineAt">, now: Date = new Date()): boolean {
  if (form.status !== "published") return false;
  if (form.deadlineAt && new Date(form.deadlineAt).getTime() < now.getTime()) return false;
  return true;
}

/** 選択された選択肢に紐づくアクションを集める */
export function collectOptionActions(form: FormDef, answers: AnswerMap): FormAction[] {
  const acts: FormAction[] = [];
  for (const sec of form.sections) {
    if (!isVisible(sec.condition, answers)) continue;
    for (const f of sec.fields) {
      if (!isVisible(f.condition, answers)) continue;
      const v = answers[f.id];
      if (v == null) continue;
      const picked = Array.isArray(v) ? v : [String(v)];
      for (const o of f.options) {
        if (picked.includes(o.label)) acts.push(...o.actions);
      }
    }
  }
  return acts;
}

export const SUBMISSION_STATUSES: SubmissionStatus[] = ["new", "doing", "done"];
