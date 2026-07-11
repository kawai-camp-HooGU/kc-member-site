// ============================================================
// フォーム：サーバー専用（service role）
//   公開フォームの取得（未ログインでも読める）／回答の保存
//   回答後アクションの実行（属性付与・会員情報保存・シナリオ・チャット・通知）
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import type { TablesUpdate } from "./database.types";
import { assembleForm, collectOptionActions, formIsOpen, isVisible, validateForm } from "./formParse";
import type { AnswerMap } from "./formParse";
import { renderMessage } from "./broadcast";
import { sendMail, isEmailConfigured } from "./email";
import { sendToMembers } from "./pushServer";
import type { FormAction, FormDef, SaveTarget } from "./models";
import { IS_DISPLAY_ONLY } from "./models";

// ── 取得 ──────────────────────────────────────────────────────
export async function loadFormBySlug(slug: string): Promise<FormDef | null> {
  const { data: f } = await supabaseAdmin.from("forms").select("*").eq("slug", slug).maybeSingle();
  if (!f) return null;
  const { data: secs } = await supabaseAdmin.from("form_sections").select("*").eq("form_id", f.id);
  const secIds = (secs ?? []).map((s) => s.id);
  const { data: fields } = await supabaseAdmin
    .from("form_fields").select("*").in("section_id", secIds.length ? secIds : [-1]);
  return assembleForm(f, secs ?? [], fields ?? []);
}

/** トークンからメンバー行を解決（未ログインは null） */
export async function memberFromToken(token: string | null): Promise<{ id: number; name: string; email: string } | null> {
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: m } = await supabaseAdmin
    .from("members").select("id, name, email").eq("user_id", data.user.id).eq("is_deleted", false).maybeSingle();
  return m ? { id: m.id, name: m.name, email: m.email ?? "" } : null;
}

// ── 送信 ──────────────────────────────────────────────────────
export interface SubmitInput {
  slug: string;
  answers: AnswerMap;                 // fieldId → 値
  files?: Record<number, { name: string; dataUrl: string }>; // fieldId → ファイル
  guestName?: string;
  guestEmail?: string;
  source?: string;
  token?: string | null;              // ログイン中会員のアクセストークン
}
export interface SubmitResult {
  ok: boolean;
  error?: string;
  errors?: Record<number, string>;
  submissionId?: number;
  thanksText?: string;
  thanksUrl?: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function submitForm(input: SubmitInput): Promise<SubmitResult> {
  const form = await loadFormBySlug(input.slug);
  if (!form) return { ok: false, error: "フォームが見つかりません" };
  if (!formIsOpen(form)) return { ok: false, error: form.deadlineMessage || "現在このフォームは受け付けていません" };

  const member = await memberFromToken(input.token ?? null);
  if (form.visibility === "member" && !member) {
    return { ok: false, error: "このフォームは会員専用です。ログインしてからご回答ください。" };
  }

  // 回答回数の制限（会員のみ判定可能）
  if (member && form.answerLimit > 0) {
    const { count } = await supabaseAdmin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", form.id)
      .eq("member_id", member.id);
    if ((count ?? 0) >= form.answerLimit) {
      return { ok: false, error: `このフォームの回答は${form.answerLimit}回までです。` };
    }
  }

  const errors = validateForm(form, input.answers);
  if (Object.keys(errors).length > 0) return { ok: false, error: "入力内容をご確認ください", errors };

  // 回答レコード
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("form_submissions")
    .insert({
      form_id: form.id,
      member_id: member?.id ?? null,
      guest_name: member ? "" : (input.guestName ?? "").slice(0, 100),
      guest_email: member ? "" : (input.guestEmail ?? "").slice(0, 200),
      source: input.source ?? "direct",
      status: "new",
    })
    .select("id")
    .single();
  if (subErr || !sub) return { ok: false, error: "回答の保存に失敗しました" };

  // 明細
  const rows: {
    submission_id: number; field_id: number; label: string;
    value: string; value_list: string[] | null; file_path: string | null;
  }[] = [];

  for (const sec of form.sections) {
    if (!isVisible(sec.condition, input.answers)) continue;
    for (const f of sec.fields) {
      if (IS_DISPLAY_ONLY(f.type)) continue;
      if (!isVisible(f.condition, input.answers)) continue;

      let filePath: string | null = null;
      if (f.type === "file") {
        const file = input.files?.[f.id];
        if (file?.dataUrl) {
          filePath = await uploadFile(form.id, sub.id, f.id, file);
        }
      }
      const v = input.answers[f.id];
      rows.push({
        submission_id: sub.id,
        field_id: f.id,
        label: f.label,
        value: Array.isArray(v) ? "" : String(v ?? ""),
        value_list: Array.isArray(v) ? v : null,
        file_path: filePath,
      });
    }
  }
  if (rows.length) await supabaseAdmin.from("form_answers").insert(rows);

  // 会員が特定できている場合のみ、アクションと会員情報の反映を実行
  if (member) {
    await saveToMember(form, input.answers, member.id);
    const actions = [...collectOptionActions(form, input.answers), ...form.afterActions];
    await runFormActions(actions, member.id);
  }

  if (form.notifyEnabled) {
    await notifyStaff(form, member?.name || input.guestName || "外部の方", sub.id).catch(() => undefined);
  }

  return { ok: true, submissionId: sub.id, thanksText: form.thanksText, thanksUrl: form.thanksUrl };
}

// ── ファイル添付 ──────────────────────────────────────────────
async function uploadFile(
  formId: number, subId: number, fieldId: number,
  file: { name: string; dataUrl: string },
): Promise<string | null> {
  try {
    const m = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl);
    if (!m) return null;
    const mime = m[1];
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.byteLength > MAX_FILE_BYTES) return null;
    const safe = file.name.replace(/[^\w.\-]/g, "_").slice(-80);
    const path = `${formId}/${subId}/${fieldId}_${Date.now()}_${safe}`;
    const { error } = await supabaseAdmin.storage.from("form-uploads").upload(path, bytes, { contentType: mime, upsert: false });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

// ── 回答の登録先（会員マスタへ反映）──────────────────────────
async function saveToMember(form: FormDef, answers: AnswerMap, memberId: number): Promise<void> {
  const patch: TablesUpdate<"members"> = {};
  let hit = false;

  for (const sec of form.sections) {
    if (!isVisible(sec.condition, answers)) continue;
    for (const f of sec.fields) {
      if (!f.saveTo || IS_DISPLAY_ONLY(f.type)) continue;
      if (!isVisible(f.condition, answers)) continue;
      const v = answers[f.id];
      const s = Array.isArray(v) ? v.join(" / ") : String(v ?? "");
      if (!s.trim()) continue;

      switch (f.saveTo as SaveTarget) {
        case "name":       patch.name = s; break;
        case "kana":       patch.kana = s; break;
        case "email":      patch.email = s; break;
        case "tel":        patch.tel = s; break;
        case "prefecture": patch.prefecture = s; break;
        case "company":    patch.company = s; break;
      }
      hit = true;
    }
  }
  if (!hit) return;
  await supabaseAdmin.from("members").update(patch).eq("id", memberId);
}

// ── アクション実行 ────────────────────────────────────────────
export async function runFormActions(actions: FormAction[], memberId: number): Promise<void> {
  if (actions.length === 0) return;

  const { data: mem } = await supabaseAdmin
    .from("members").select("*").eq("id", memberId).maybeSingle();

  for (const a of actions) {
    try {
      switch (a.type) {
        case "attr_add":
          if (a.attrId != null) {
            const { data: exists } = await supabaseAdmin
              .from("member_attributes").select("member_id")
              .eq("member_id", memberId).eq("attribute_id", a.attrId).maybeSingle();
            if (!exists) {
              await supabaseAdmin.from("member_attributes").insert({ member_id: memberId, attribute_id: a.attrId });
            }
          }
          break;

        case "attr_remove":
          if (a.attrId != null) {
            await supabaseAdmin.from("member_attributes")
              .delete().eq("member_id", memberId).eq("attribute_id", a.attrId);
          }
          break;

        case "scenario_start":
          if (a.scenarioId != null) {
            const { data: e } = await supabaseAdmin
              .from("scenario_entries").select("id")
              .eq("scenario_id", a.scenarioId).eq("member_id", memberId).maybeSingle();
            if (!e) {
              await supabaseAdmin.from("scenario_entries").insert({
                scenario_id: a.scenarioId, member_id: memberId, next_step: 0, status: "active",
              });
            }
          }
          break;

        case "scenario_stop":
          if (a.scenarioId != null) {
            await supabaseAdmin.from("scenario_entries").update({ status: "done" })
              .eq("scenario_id", a.scenarioId).eq("member_id", memberId);
          }
          break;

        case "chat_message":
          if (a.body?.trim() && mem) {
            const body = renderMessage(a.body, {
              name: mem.name, kana: mem.kana ?? "", company: mem.company ?? "",
              email: mem.email ?? "", prefecture: mem.prefecture ?? "", source: mem.source ?? "",
            });
            await sendStaffChat(memberId, body);
          }
          break;
      }
    } catch (e) {
      console.error("フォームアクション実行エラー:", a.type, e);
    }
  }
}

/** 運営（事務局）からのチャットメッセージを送る */
async function sendStaffChat(memberId: number, body: string): Promise<void> {
  let conversationId: number;
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations").select("id").eq("member_id", memberId).maybeSingle();
  if (conv) {
    conversationId = conv.id;
  } else {
    const { data: created } = await supabaseAdmin
      .from("chat_conversations").insert({ member_id: memberId }).select("id").single();
    if (!created) return;
    conversationId = created.id;
  }
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId, sender_member_id: null, sender_side: "staff", body,
  });
  const snip = body.length > 60 ? `${body.slice(0, 60)}…` : body;
  await supabaseAdmin.from("chat_conversations")
    .update({ last_message_at: new Date().toISOString(), last_message_snip: snip })
    .eq("id", conversationId);
}

// ── 担当者への通知（メール＋プッシュ）────────────────────────
async function notifyStaff(form: FormDef, who: string, submissionId: number): Promise<void> {
  const { data: staff } = await supabaseAdmin
    .from("members").select("id, email, role").eq("is_deleted", false)
    .in("role", ["管理者", "オペレーター"]);
  if (!staff || staff.length === 0) return;

  const subject = `【フォーム回答】${form.name}`;
  const text = `${form.name} に新しい回答が届きました。\n回答者：${who}\n回答ID：${submissionId}\n\n管理画面の「フォーム ＞ 問合せ一覧」からご確認ください。`;

  if (isEmailConfigured()) {
    for (const s of staff) {
      if (!s.email) continue;
      await sendMail({ to: s.email, subject, text }).catch(() => undefined);
    }
  }
  await sendToMembers(
    staff.map((s) => s.id),
    { title: subject, body: `回答者：${who}`, url: "/", tag: `form-${form.id}` },
    "news",
  ).catch(() => undefined);
}
