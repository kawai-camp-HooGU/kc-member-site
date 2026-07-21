// ============================================================
// フォーム：DB行 ⇄ モデル変換 と 共通ロジック（純粋関数・supabase 非依存）
//   クライアント（lib/forms.ts）とサーバー（lib/formsServer.ts）の両方から使う
// ============================================================
import type { Tables } from "./database.types";
import type {
  AutoReplyBlock, CondMatch, FormAction, FormAnswer, FormDef, FormDesign, FormField, FormOption,
  FormSection, FieldCondition, FieldRule, FieldType, FormStatus, FormVisibility, SaveTarget,
  SubmissionStatus,
} from "./models";
import { DEFAULT_AUTO_REPLY, DEFAULT_FORM_DESIGN, IS_DISPLAY_ONLY } from "./models";

// ── 変換：DB行 → モデル ───────────────────────────────────────
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * design(jsonb) → FormDesign。
 *   legacyThanksUrl … thanksMode が未保存の古いデータの補完に使う。
 *   URLが入っていれば "url"、無ければ "text" とみなす（旧挙動と同じ見え方になる）。
 */
export function toDesign(v: unknown, legacyThanksUrl = ""): FormDesign {
  const d = (v && typeof v === "object" ? v : {}) as Partial<FormDesign>;
  return {
    ...DEFAULT_FORM_DESIGN,
    ...d,
    // 入れ子は古いデータ（未設定）でも既定で埋める
    guestContact: { ...DEFAULT_FORM_DESIGN.guestContact, ...(d.guestContact ?? {}) },
    thanksMode: d.thanksMode ?? (legacyThanksUrl.trim() ? "url" : "text"),
    thanksHtml: d.thanksHtml ?? "",
    autoReply: {
      ...DEFAULT_AUTO_REPLY,
      ...(d.autoReply ?? {}),
      blocks: asArray<Partial<AutoReplyBlock> & { condition?: unknown }>(d.autoReply?.blocks).map((b) => ({
        conditions: toConditions(b),
        condMatch: b?.condMatch === "any" ? "any" : "all",
        body: String(b?.body ?? ""),
      })),
    },
  };
}

export function toCondition(v: unknown): FieldCondition | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<FieldCondition>;
  if (typeof c.fieldId !== "number") return null;
  return { fieldId: c.fieldId, op: c.op === "neq" ? "neq" : "eq", value: String(c.value ?? "") };
}

/**
 * 自動返信ブロックの条件を配列に正規化する。
 *   新形式（conditions[]）を優先し、無ければ旧形式（condition 単体）を1件の配列に畳む。
 *   これで旧データの再保存が不要になり、読み込んだ時点で内部表現が1つに揃う。
 */
export function toConditions(b: { conditions?: unknown; condition?: unknown } | null | undefined): FieldCondition[] {
  const list = asArray<unknown>(b?.conditions).map(toCondition).filter((c): c is FieldCondition => c !== null);
  if (list.length > 0) return list;
  const legacy = toCondition(b?.condition);
  return legacy ? [legacy] : [];
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
    design: toDesign(r.design, r.thanks_url ?? ""),
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

/**
 * 差し込み変数を含む文字列を「素のテキスト」と「{{変数}}」に切り分ける。
 *   入力欄のハイライト表示（TokenText）と、未知トークンの検出に使う純粋関数。
 *   ネストは考慮しない（{{ }} の中に { } は入らない前提）。
 */
export function splitTokens(text: string): { text: string; isToken: boolean }[] {
  const out: { text: string; isToken: boolean }[] = [];
  const re = /\{\{[^{}]*\}\}/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), isToken: false });
    out.push({ text: m[0], isToken: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isToken: false });
  return out;
}

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

/**
 * 複数条件を満たすか。条件が空なら常に表示。
 *   match="all" … すべて満たす（AND）／"any" … どれか1つ満たす（OR）
 * 単体条件の isVisible をそのまま畳んでいるので、分岐UIと挙動がズレない。
 */
export function isVisibleAll(conds: FieldCondition[], match: CondMatch, answers: AnswerMap): boolean {
  if (conds.length === 0) return true;
  return match === "any"
    ? conds.some((c) => isVisible(c, answers))
    : conds.every((c) => isVisible(c, answers));
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

// ── ご連絡先欄（氏名・メール）の連動 ──────────────────────────
/**
 * 「登録先＝氏名／メール」の設問を探す。
 *   分岐で非表示になっている設問は対象外（回答されないため）。
 *   複数あるときは最初に見つかったものを使う（サーバーの pickEmail/pickName と同じ順序）。
 */
export function findContactFields(
  form: Pick<FormDef, "sections">, answers: AnswerMap,
): { nameField: FormField | null; emailField: FormField | null } {
  let nameField: FormField | null = null;
  let emailField: FormField | null = null;
  for (const sec of form.sections) {
    if (!isVisible(sec.condition, answers)) continue;
    for (const f of sec.fields) {
      if (IS_DISPLAY_ONLY(f.type)) continue;
      if (!isVisible(f.condition, answers)) continue;
      if (!nameField && f.saveTo === "name") nameField = f;
      if (!emailField && f.saveTo === "email") emailField = f;
    }
  }
  return { nameField, emailField };
}

/**
 * ご連絡先欄に何を出すかを決める。
 *   mode="auto" のとき、設問で賄える項目は出さない。両方賄えるなら欄ごと出さない。
 *   ⚠️ 分岐で設問が消えると自動的に欄が復活する（＝メールが取れない事故を防ぐ）。
 */
export interface GuestContactNeed {
  showName: boolean;
  showEmail: boolean;
  /** 欄そのものを出すか */
  show: boolean;
  /** 設問側から引き継ぐ値（送信時に guestName/guestEmail へ入れる） */
  nameFromField: string;
  emailFromField: string;
}
export function guestContactNeed(form: FormDef, answers: AnswerMap): GuestContactNeed {
  const gc = { ...DEFAULT_FORM_DESIGN.guestContact, ...form.design.guestContact };
  const { nameField, emailField } = findContactFields(form, answers);
  const auto = gc.mode !== "always";

  const valOf = (f: FormField | null): string => {
    if (!f) return "";
    const v = answers[f.id];
    return (Array.isArray(v) ? v.join(" ") : String(v ?? "")).trim();
  };

  const showName = !(auto && nameField);
  const showEmail = !(auto && emailField);
  return {
    showName, showEmail,
    show: showName || showEmail,
    nameFromField: auto ? valOf(nameField) : "",
    emailFromField: auto ? valOf(emailField) : "",
  };
}

// ── 自動返信メール ────────────────────────────────────────────
/** 回答を「設問名：回答」の一覧テキストにする */
export function answersToText(form: FormDef, answers: AnswerMap): string {
  const lines: string[] = [];
  for (const sec of form.sections) {
    if (!isVisible(sec.condition, answers)) continue;
    for (const f of sec.fields) {
      if (IS_DISPLAY_ONLY(f.type)) continue;
      if (!isVisible(f.condition, answers)) continue;
      const v = answers[f.id];
      const s = Array.isArray(v) ? v.join("、") : String(v ?? "");
      lines.push(`${f.label || "（項目名なし）"}：${s || "（未入力）"}`);
    }
  }
  return lines.join("\n");
}

export interface AutoReplyContext {
  formName: string;
  name: string;
  email: string;
  answeredAt: Date;
}

/** {{…}} の差し込みを解決する */
export function fillTokens(
  tpl: string, form: FormDef, answers: AnswerMap, ctx: AutoReplyContext,
): string {
  const dt = ctx.answeredAt;
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  let out = tpl
    .replace(/\{\{氏名\}\}/g, ctx.name)
    .replace(/\{\{メール\}\}/g, ctx.email)
    .replace(/\{\{フォーム名\}\}/g, ctx.formName)
    .replace(/\{\{回答日時\}\}/g, stamp)
    .replace(/\{\{回答内容ぜんぶ\}\}/g, answersToText(form, answers));

  // {{Q:設問名}} … 該当する設問の回答に置き換える
  out = out.replace(/\{\{Q:([^}]+)\}\}/g, (_m, label: string) => {
    for (const sec of form.sections) {
      for (const f of sec.fields) {
        if (f.label !== label.trim()) continue;
        const v = answers[f.id];
        return Array.isArray(v) ? v.join("、") : String(v ?? "");
      }
    }
    return "";
  });
  return out;
}

/**
 * 自動返信メールの件名・本文を組み立てる。
 *   条件を満たしたブロックだけを上から連結する。純粋関数（送信はしない）。
 *   本文が空になる場合は null を返す（＝送らない）。
 */
export function buildAutoReply(
  form: FormDef, answers: AnswerMap, ctx: AutoReplyContext,
): { subject: string; text: string } | null {
  const ar = form.design.autoReply;
  if (!ar?.enabled) return null;

  const body = ar.blocks
    .filter((b) => isVisibleAll(b.conditions, b.condMatch, answers))
    .map((b) => fillTokens(b.body, form, answers, ctx).trim())
    .filter((s) => s !== "")
    .join("\n\n");
  if (!body.trim()) return null;

  const subject = fillTokens(ar.subject || `【${ctx.formName}】ご回答ありがとうございました`, form, answers, ctx);
  return { subject: subject.trim(), text: body };
}
