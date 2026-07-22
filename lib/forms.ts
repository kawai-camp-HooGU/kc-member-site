// ============================================================
// フォーム データアクセス（クライアント／管理画面用）
//   CRUD（一覧/取得/保存/複製/削除）・回答（問合せ）一覧・CSV出力
//   公開フォームからの送信は /api/form/submit（service role）が担当する
// ============================================================
import { supabase } from "./supabase";
import type { Json, TablesInsert, TablesUpdate } from "./database.types";
import type { FormDef, FormSubmission, SubmissionStatus, Member } from "./models";
import { assembleForm, toAnswer } from "./formParse";
import { sanitizeBodyHtml } from "./richText";

// ── 一覧 ──────────────────────────────────────────────────────
export interface FormListItem {
  id: number;
  name: string;
  folder: string;
  slug: string;
  status: string;
  visibility: string;
  deadlineAt: string;
  fieldCount: number;
  sectionCount: number;
  total: number;   // 回答数
  newCount: number; // 未対応
  updatedAt: string;
}

export async function fetchForms(): Promise<FormListItem[]> {
  const { data: rows } = await supabase.from("forms").select("*").order("id", { ascending: false });
  if (!rows) return [];
  const ids = rows.map((r) => r.id);
  const key = ids.length ? ids : [-1];
  const { data: secs } = await supabase.from("form_sections").select("id, form_id").in("form_id", key);
  const secIds = (secs ?? []).map((s) => s.id);
  const { data: fields } = await supabase
    .from("form_fields").select("id, section_id, type").in("section_id", secIds.length ? secIds : [-1]);
  const { data: subs } = await supabase.from("form_submissions").select("form_id, status").in("form_id", key);

  const secByForm = new Map<number, number[]>();
  for (const s of secs ?? []) secByForm.set(s.form_id, [...(secByForm.get(s.form_id) ?? []), s.id]);

  return rows.map((r) => {
    const mySecs = secByForm.get(r.id) ?? [];
    const myFields = (fields ?? []).filter((f) => mySecs.includes(f.section_id) && f.type !== "heading");
    const mySubs = (subs ?? []).filter((s) => s.form_id === r.id);
    return {
      id: r.id, name: r.name ?? "", folder: r.folder ?? "", slug: r.slug,
      status: r.status ?? "draft", visibility: r.visibility ?? "both",
      deadlineAt: r.deadline_at ? r.deadline_at.slice(0, 16) : "",
      fieldCount: myFields.length, sectionCount: mySecs.length,
      total: mySubs.length, newCount: mySubs.filter((s) => s.status === "new").length,
      updatedAt: r.updated_at ?? "",
    };
  });
}

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchForm(id: number): Promise<FormDef | null> {
  const { data: f } = await supabase.from("forms").select("*").eq("id", id).maybeSingle();
  if (!f) return null;
  const { data: secs } = await supabase.from("form_sections").select("*").eq("form_id", id);
  const secIds = (secs ?? []).map((s) => s.id);
  const { data: fields } = await supabase
    .from("form_fields").select("*").in("section_id", secIds.length ? secIds : [-1]);
  return assembleForm(f, secs ?? [], fields ?? []);
}

// ── 保存（ID を保てるように差分更新。条件分岐の参照IDを壊さない）──
export async function saveForm(form: FormDef): Promise<number | null> {
  const row: TablesInsert<"forms"> = {
    // ⚠️ slug は含めない。新規時はDBが自動発行し、更新時はトリガが変更を拒否する。
    name: form.name || form.title || "無題のフォーム",
    folder: form.folder || null,
    title: form.title,
    description: form.description,
    status: form.status,
    visibility: form.visibility,
    deadline_at: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : null,
    deadline_message: form.deadlineMessage,
    answer_limit: form.answerLimit,
    confirm_dialog: form.confirmDialog,
    confirm_text: form.confirmText,
    thanks_url: form.thanksUrl,
    thanks_text: form.thanksText,
    // 完了画面のHTMLはDBに汚れたまま残さない（多層防御。表示側でも再サニタイズする）
    design: {
      ...form.design,
      thanksHtml: sanitizeBodyHtml(form.design.thanksHtml),
    } as unknown as Json,
    after_actions: form.afterActions as unknown as Json,
    autofill_member: form.autofillMember,
    notify_enabled: form.notifyEnabled,
    show_on_calendar: form.showOnCalendar,
    calendar_label: form.calendarLabel,
    updated_at: new Date().toISOString(),
  };

  let fid = form.id;
  if (fid > 0) {
    const { error } = await supabase.from("forms").update(row).eq("id", fid);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("forms").insert(row).select("id").single();
    if (error || !data) throw error ?? new Error("フォームの作成に失敗しました");
    fid = data.id;
  }

  // 既存セクション/設問
  const { data: oldSecs } = await supabase.from("form_sections").select("id").eq("form_id", fid);
  const oldSecIds = (oldSecs ?? []).map((s) => s.id);
  const { data: oldFields } = await supabase
    .from("form_fields").select("id").in("section_id", oldSecIds.length ? oldSecIds : [-1]);

  const idMap = new Map<number, number>();  // 一時ID(負) → 実ID

  // セクション（更新 / 追加）
  const keepSec: number[] = [];
  for (let i = 0; i < form.sections.length; i++) {
    const s = form.sections[i];
    // 条件は第2パスで参照IDを実IDへ解決してから入れる（ここでは空で置く）
    const sRow = { form_id: fid, name: s.name, sort_order: i, condition: null as unknown as Json };
    if (s.id > 0 && oldSecIds.includes(s.id)) {
      await supabase.from("form_sections").update(sRow).eq("id", s.id);
      keepSec.push(s.id);
      idMap.set(s.id, s.id);
    } else {
      const { data } = await supabase.from("form_sections").insert(sRow).select("id").single();
      if (data) { keepSec.push(data.id); idMap.set(s.id, data.id); }
    }
  }
  // 消えたセクション（設問は cascade）
  const delSec = oldSecIds.filter((id) => !keepSec.includes(id));
  if (delSec.length) await supabase.from("form_sections").delete().in("id", delSec);

  // 設問（更新 / 追加）
  const oldFieldIds = (oldFields ?? []).map((f) => f.id);
  const keepField: number[] = [];
  for (const s of form.sections) {
    const sid = idMap.get(s.id) ?? s.id;
    for (let i = 0; i < s.fields.length; i++) {
      const f = s.fields[i];
      const fRow: TablesInsert<"form_fields"> = {
        section_id: sid,
        type: f.type,
        label: f.label,
        description: f.description,
        desc_html: f.descHtml,
        placeholder: f.placeholder,
        default_value: f.defaultValue,
        required: f.required,
        rule: f.rule || null,
        min_len: f.minLen === "" ? null : Number(f.minLen),
        max_len: f.maxLen === "" ? null : Number(f.maxLen),
        max_select: f.maxSelect === "" ? null : Number(f.maxSelect),
        save_to: f.saveTo || null,
        options: f.options as unknown as Json,
        option_cards: f.optionCards,
        condition: null,          // 条件は ID 解決後に第2パスで入れる
        sort_order: i,
      };
      if (f.id > 0 && oldFieldIds.includes(f.id)) {
        await supabase.from("form_fields").update(fRow).eq("id", f.id);
        keepField.push(f.id);
        idMap.set(f.id, f.id);
      } else {
        const { data } = await supabase.from("form_fields").insert(fRow).select("id").single();
        if (data) { keepField.push(data.id); idMap.set(f.id, data.id); }
      }
    }
  }
  const delField = oldFieldIds.filter((id) => !keepField.includes(id));
  if (delField.length) await supabase.from("form_fields").delete().in("id", delField);

  // 第2パス：条件（分岐）の参照IDを実IDへ解決して保存
  //   condition は CondGroup（{ match, conditions[] }）。グループ内の各条件の
  //   fieldId を一時ID→実IDへ付け替える。空グループ（条件なし）は null で保存する。
  const resolve = (group: FormDef["sections"][number]["condition"]): Json => {
    if (!group || group.conditions.length === 0) return null as unknown as Json;
    return {
      match: group.match,
      conditions: group.conditions.map((c) => ({ ...c, fieldId: idMap.get(c.fieldId) ?? c.fieldId })),
    } as unknown as Json;
  };
  for (const s of form.sections) {
    const sid = idMap.get(s.id) ?? s.id;
    await supabase.from("form_sections").update({ condition: resolve(s.condition) }).eq("id", sid);
  }
  for (const s of form.sections) {
    for (const f of s.fields) {
      const fid2 = idMap.get(f.id) ?? f.id;
      await supabase.from("form_fields").update({ condition: resolve(f.condition) }).eq("id", fid2);
    }
  }

  return fid;
}

export async function deleteForm(id: number): Promise<void> {
  await supabase.from("forms").delete().eq("id", id);
}

/** 複製（下書きとしてコピー） */
export async function duplicateForm(id: number): Promise<number | null> {
  const src = await fetchForm(id);
  if (!src) return null;
  const copy: FormDef = {
    ...src,
    id: 0,
    name: `${src.name}（コピー）`,
    slug: "",                 // 複製先の公開URLはDBが新しく発行する
    status: "draft",
    // 複製では分岐条件を引き継がない（参照先のIDが新しくなるため）。空グループにする。
    sections: src.sections.map((s) => ({
      ...s, id: -Math.abs(s.id) - 1000,
      fields: s.fields.map((f) => ({ ...f, id: -Math.abs(f.id) - 1000, condition: { match: "all" as const, conditions: [] } })),
      condition: { match: "all" as const, conditions: [] },
    })),
  };
  return saveForm(copy);
}

/**
 * @deprecated slug は DB が自動発行するランダムトークンになったため、重複チェックは不要。
 */
export async function slugTaken(slug: string, selfId: number): Promise<boolean> {
  const { data } = await supabase.from("forms").select("id").eq("slug", slug);
  return (data ?? []).some((r) => r.id !== selfId);
}

// ── 回答（問合せ）─────────────────────────────────────────────
export async function fetchSubmissions(formId: number): Promise<FormSubmission[]> {
  const { data: subs } = await supabase
    .from("form_submissions").select("*").eq("form_id", formId).order("submitted_at", { ascending: false });
  if (!subs || subs.length === 0) return [];
  const ids = subs.map((s) => s.id);
  const { data: answers } = await supabase.from("form_answers").select("*").in("submission_id", ids);
  return subs.map((s) => ({
    id: s.id, formId: s.form_id, memberId: s.member_id,
    guestName: s.guest_name ?? "", guestEmail: s.guest_email ?? "",
    status: (s.status as SubmissionStatus) ?? "new",
    // Phase 3：source(送信チャネル) → channel にリネーム。source_id は「流入経路」。
    assigneeId: s.assignee_id, channel: s.channel ?? "direct", sourceId: s.source_id ?? null,
    submittedAt: s.submitted_at ?? "",
    answers: (answers ?? []).filter((a) => a.submission_id === s.id).map(toAnswer),
  }));
}

/**
 * 回答1件を取得（回答詳細画面 /ops/submissions/[id] 用）。
 *   フォーム定義も一緒に返す（設問の順序・ラベルを正として表示するため）。
 */
export async function fetchSubmission(
  id: number,
): Promise<{ submission: FormSubmission; form: FormDef | null } | null> {
  const { data: s } = await supabase.from("form_submissions").select("*").eq("id", id).maybeSingle();
  if (!s) return null;

  const [{ data: answers }, form] = await Promise.all([
    supabase.from("form_answers").select("*").eq("submission_id", id),
    fetchForm(s.form_id),
  ]);

  const submission: FormSubmission = {
    id: s.id, formId: s.form_id, memberId: s.member_id,
    guestName: s.guest_name ?? "", guestEmail: s.guest_email ?? "",
    status: (s.status as SubmissionStatus) ?? "new",
    assigneeId: s.assignee_id, channel: s.channel ?? "direct", sourceId: s.source_id ?? null,
    submittedAt: s.submitted_at ?? "",
    answers: (answers ?? []).map(toAnswer),
  };
  return { submission, form };
}

export async function updateSubmission(
  id: number,
  patch: { status?: SubmissionStatus; assigneeId?: number | null; memberId?: number | null },
): Promise<void> {
  const row: TablesUpdate<"form_submissions"> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
  if (patch.memberId !== undefined) row.member_id = patch.memberId;
  if (Object.keys(row).length === 0) return;
  await supabase.from("form_submissions").update(row).eq("id", id);
}

export async function deleteSubmission(id: number): Promise<void> {
  await supabase.from("form_submissions").delete().eq("id", id);
}

/** 添付ファイルの一時URL（60分） */
export async function fileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("form-uploads").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ── CSV ───────────────────────────────────────────────────────
const csvCell = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;

export function submissionsToCsv(form: FormDef, subs: FormSubmission[], members: Member[]): string {
  const byId = new Map(members.map((m) => [m.id, m]));
  const fields = form.sections.flatMap((s) => s.fields).filter((f) => f.type !== "heading");
  const head = ["回答日時", "回答者", "会員ID", "メール", "対応状況", "担当", ...fields.map((f) => f.label)];
  const lines = [head.map(csvCell).join(",")];
  const statusLabel: Record<string, string> = { new: "未対応", doing: "対応中", done: "完了" };

  for (const s of subs) {
    const m = s.memberId != null ? byId.get(s.memberId) : undefined;
    const ans = new Map(s.answers.map((a) => [a.fieldId ?? -1, a]));
    const cells = [
      (s.submittedAt || "").replace("T", " ").slice(0, 16),
      m?.name ?? s.guestName ?? "",
      m ? String(m.id) : "",
      m?.email ?? s.guestEmail ?? "",
      statusLabel[s.status] ?? s.status,
      s.assigneeId != null ? byId.get(s.assigneeId)?.name ?? "" : "",
      ...fields.map((f) => {
        const a = ans.get(f.id);
        if (!a) return "";
        if (a.valueList.length) return a.valueList.join(" / ");
        if (a.filePath) return a.filePath.split("/").pop() ?? "";
        return a.value;
      }),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
