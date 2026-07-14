// ============================================================
// フォーム：サーバー専用（service role）
//   公開フォームの取得（未ログインでも読める）／回答の保存
//   回答後アクションの実行（属性付与・会員情報保存・シナリオ・チャット・通知）
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import type { TablesUpdate } from "./database.types";
import { assembleForm, collectOptionActions, formIsOpen, isVisible, validateForm } from "./formParse";
import type { AnswerMap } from "./formParse";
import { runActions } from "./actionsServer";
import { resolveSourceId } from "./sourcesServer";
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

// ── 会員登録（外部ロール）──────────────────────────────────────
/** 回答からメールアドレスを拾う（saveTo="email" の設問 → ゲスト入力欄の順） */
function pickEmail(form: FormDef, answers: AnswerMap, guestEmail?: string): string {
  for (const sec of form.sections) {
    for (const f of sec.fields) {
      if (f.saveTo !== "email") continue;
      const v = answers[f.id];
      const s = Array.isArray(v) ? v[0] : String(v ?? "");
      if (s && s.includes("@")) return s.trim();
    }
  }
  return (guestEmail ?? "").trim();
}
/** 回答から氏名を拾う（saveTo="name" の設問 → ゲスト入力欄の順） */
function pickName(form: FormDef, answers: AnswerMap, guestName?: string): string {
  for (const sec of form.sections) {
    for (const f of sec.fields) {
      if (f.saveTo !== "name") continue;
      const v = answers[f.id];
      const s = Array.isArray(v) ? v.join(" ") : String(v ?? "");
      if (s.trim()) return s.trim();
    }
  }
  return (guestName ?? "").trim();
}

/**
 * 未ログインの回答者を「外部」ロールの会員として登録する（パスワードレス）。
 *
 *   ・auth ユーザーは admin.createUser({ email_confirm: true }) で作る。
 *     パスワードは設定せず「確認済み」状態にするため、マジックリンク（/auth/trial・/login）
 *     だけでログインできる。メールは一切送られない。
 *     ⚠️ 以前は inviteUserByEmail() を使っており、「パスワードを設定してください」という
 *        招待メール（→ /set-password）が届いていた。体験版は送信完了と同時に
 *        /auth/trial で即ログインさせる設計なので、この招待メールは不要かつ
 *        ユーザーを混乱させるため廃止した。本会員へ昇格する際に、改めて
 *        メール確認（パスワード/パスキー設定）を要求すること。
 *   ・すでに members に同じメールがある → 何もしない（"exists"）。乗っ取り防止のため既存行には触れない。
 *   ・members 行は無いが auth.users にだけ存在する場合も createUser がエラーになる → "exists"。
 */
async function signupExternalMember(
  email: string, name: string, sourceId: number | null,
): Promise<{
  member: { id: number; name: string; email: string } | null;
  status: "signed_up" | "exists" | "no_email";
  /** 体験版の即ログイン用ワンタイムトークン（取得できなければ undefined） */
  tokenHash?: string;
}> {
  if (!email || !email.includes("@")) return { member: null, status: "no_email" };

  const { data: existing } = await supabaseAdmin
    .from("members").select("id, name, email").eq("email", email).eq("is_deleted", false).maybeSingle();
  if (existing) return { member: null, status: "exists" };

  // パスワード無し・確認済みの auth ユーザーを作成する（メール送信なし）
  const { data: authUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,                       // ⚠️ これが無いとマジックリンクでログインできない
    user_metadata: { display_name: name || email },
  });
  if (createErr || !authUser?.user) {
    // 既に auth.users にいる（members 行だけ無い）場合もここに来る
    console.warn("外部会員の作成に失敗（auth）:", createErr?.message);
    return { member: null, status: "exists" };
  }

  const now = new Date().toISOString();
  const { data: created, error: insErr } = await supabaseAdmin
    .from("members")
    .insert({
      name: name || email,
      role: "外部",
      email,
      user_id: authUser.user.id,
      source_id: sourceId,
      last_source_id: sourceId,
      source_at: sourceId != null ? now : null,
    })
    .select("id, name, email")
    .single();
  if (insErr || !created) {
    console.error("外部会員の作成に失敗:", insErr?.message);
    // members 行を作れなかったのに auth ユーザーだけ残ると、以後この人は
    // 「exists 扱いなのに会員行が無い」宙ぶらりんになる。作った分は戻す。
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id).catch(() => {});
    return { member: null, status: "exists" };
  }

  // ── 体験版：その場でログインさせるためのワンタイムトークンを発行 ──
  //   メールのリンクを踏ませる代わりに、送信完了と同時にセッションを張る。
  //   generateLink は「リンクを生成するだけ（メールは送らない）」なので、
  //   ここで得た hashed_token を verifyOtp に渡せば本人確認済みのセッションになる。
  //
  //   ⚠️ トレードオフ：他人のメールアドレスを入力しても体験版に入れてしまう。
  //      外部ロールが見られるのは体験用コンテンツのみ（RLSで業務データは不可視）なので許容する。
  //      本会員へ昇格する際に、改めてメール確認（パスワード/パスキー設定）を要求すること。
  let tokenHash: string | undefined;
  try {
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) console.warn("体験セッションのトークン発行に失敗:", linkErr.message);
    tokenHash = link?.properties?.hashed_token ?? undefined;
  } catch (e) {
    console.warn("体験セッションのトークン発行に失敗:", e);
  }

  return {
    member: { id: created.id, name: created.name, email: created.email ?? email },
    status: "signed_up",
    tokenHash,
  };
}

// ── 送信 ──────────────────────────────────────────────────────
export interface SubmitInput {
  slug: string;
  answers: AnswerMap;                 // fieldId → 値
  files?: Record<number, { name: string; dataUrl: string }>; // fieldId → ファイル
  guestName?: string;
  guestEmail?: string;
  /**
   * 送信チャネル（direct|chat|broadcast|scenario|qr）。
   *   ⚠️ Phase 3：会員の「流入経路」とは別物。用語衝突を解消して channel に統一した。
   */
  channel?: string;
  /** 流入経路のキー（URL の ?src=）。sources.key と照合して source_id に解決する。 */
  srcKey?: string | null;
  token?: string | null;              // ログイン中会員のアクセストークン
}
export interface SubmitResult {
  ok: boolean;
  error?: string;
  errors?: Record<number, string>;
  submissionId?: number;
  thanksText?: string;
  thanksUrl?: string;
  /**
   * 会員登録アクションの結果。
   *   "signed_up"=外部ロールで新規登録（パスワードレス・メール送信なし）
   *   "exists"=登録済 ／ "no_email"=メール未取得
   */
  signup?: "signed_up" | "exists" | "no_email";
  /**
   * 体験版セッション用のワンタイムトークン（パスワードレス）。
   *   新規に外部会員として登録できたときだけ返す。
   *   クライアントはこれを /auth/trial に渡すと、その場でログイン状態になる。
   *   ⚠️ 一度使うと無効になる。URLに載るがメールのマジックリンクと同じ性質。
   */
  trialTokenHash?: string;
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

  // 流入経路（?src=）をマスタと照合。未登録キーなら null（＝経路不明として記録）。
  const sourceId = await resolveSourceId(input.srcKey ?? null);

  // 回答レコード
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("form_submissions")
    .insert({
      form_id: form.id,
      member_id: member?.id ?? null,
      guest_name: member ? "" : (input.guestName ?? "").slice(0, 100),
      guest_email: member ? "" : (input.guestEmail ?? "").slice(0, 200),
      channel: input.channel ?? "direct",
      source_id: sourceId,
      status: "new",
    })
    .select("id")
    .single();
  if (subErr || !sub) return { ok: false, error: "回答の保存に失敗しました" };

  // 会員がまだ経路を持っていなければ、この回答の経路を「初回流入」として付与する
  //   （ファーストクリック方式：既に source_id があれば上書きしない）
  if (member && sourceId != null) {
    await supabaseAdmin.from("members")
      .update({ last_source_id: sourceId })
      .eq("id", member.id);
    await supabaseAdmin.from("members")
      .update({ source_id: sourceId, source_at: new Date().toISOString() })
      .eq("id", member.id)
      .is("source_id", null);
  }

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

  // ── 会員登録（外部ロール）──
  //   未ログインの回答者でも、回答後アクションに member_signup があれば会員化する。
  //   これによりメルマガ登録フォーム → 外部ロールでポータル利用、という導線が成立する。
  let acting = member;
  let signup: SubmitResult["signup"];
  let trialTokenHash: string | undefined;
  if (!acting) {
    const wantSignup = [...collectOptionActions(form, input.answers), ...form.afterActions]
      .some((a) => a.type === "member_signup");
    if (wantSignup) {
      const email = pickEmail(form, input.answers, input.guestEmail);
      const name  = pickName(form, input.answers, input.guestName);
      const r = await signupExternalMember(email, name, sourceId);
      signup = r.status;
      trialTokenHash = r.tokenHash;
      if (r.member) {
        acting = r.member;
        // 回答を本人に紐付け直す（以降の集計・重複判定が効くように）
        await supabaseAdmin.from("form_submissions")
          .update({ member_id: r.member.id, guest_name: "", guest_email: "" })
          .eq("id", sub.id);
      }
    }
  }

  // 会員が特定できている場合のみ、アクションと会員情報の反映を実行
  if (acting) {
    await saveToMember(form, input.answers, acting.id);
    const actions = [...collectOptionActions(form, input.answers), ...form.afterActions];
    await runFormActions(actions, acting.id);
  }

  if (form.notifyEnabled) {
    await notifyStaff(form, acting?.name || input.guestName || "外部の方", sub.id).catch(() => undefined);
  }

  return {
    ok: true, submissionId: sub.id,
    thanksText: form.thanksText, thanksUrl: form.thanksUrl,
    signup, trialTokenHash,
  };
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
//   実体は lib/actionsServer.ts に移設（属性の自動更新で共用）。
//   ここは後方互換のための薄い委譲。挙動は従来と同じ。
export async function runFormActions(actions: FormAction[], memberId: number): Promise<void> {
  await runActions(actions, memberId);
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
