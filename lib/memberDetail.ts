// ============================================================
// メンバー詳細画面（/ops/members/[id]）のデータアクセス
//
//   従来はメンバー編集がモーダルで、MasterView が持っている
//   「全件ロード済みの members 配列」から該当行を引いていた。
//   詳細画面は別ウィンドウで独立して開くため、MasterContext が無い。
//   → この画面に必要な分だけを単体で取得する。
// ============================================================
import { supabase, toMember } from "./supabase";
import type { Member, MemberMemo, SubmissionStatus } from "./models";

export interface MemberDetail {
  member: Member;
  /** 事務局とのチャット会話ID（まだ会話が無ければ null） */
  conversationId: number | null;
}

/** 1人分のメンバー情報（属性・メモ・通知・ログイン記録まで） */
export async function fetchMemberDetail(id: number): Promise<MemberDetail | null> {
  const [
    { data: row },
    { data: attrs },
    { data: memos },
    { data: devices },
    { data: notify },
    { data: conv },
  ] = await Promise.all([
    supabase.from("members_visible").select("*").eq("id", id).maybeSingle(),
    supabase.from("member_attributes").select("attribute_id").eq("member_id", id),
    supabase.from("member_memos").select("*").eq("member_id", id).order("sort_order"),
    supabase.from("push_subscriptions").select("user_agent, created_at").eq("member_id", id),
    supabase.from("notification_settings").select("*").eq("member_id", id).maybeSingle(),
    supabase.from("chat_conversations").select("id").eq("member_id", id).maybeSingle(),
  ]);

  if (!row) return null;

  const m = toMember(row);
  m.attrIds = (attrs ?? []).map((a) => a.attribute_id);
  m.memos = (memos ?? []).map((r): MemberMemo => ({
    id: r.id, title: r.title ?? "", body: r.body ?? "", updatedAt: r.updated_at ?? "",
  }));
  const devs = (devices ?? []).map((d) => ({ userAgent: d.user_agent ?? "", createdAt: d.created_at ?? "" }));
  m.pushDevices = devs.length;
  m.pushDeviceInfo = devs;
  // 設定行が無い場合は既定ON（fetchAllData と同じ扱い）
  m.notifyEnabled     = notify?.enabled ?? true;
  m.notifyChatEnabled = notify?.chat_enabled ?? true;
  m.notifyNewsEnabled = notify?.news_enabled ?? true;

  return { member: m, conversationId: conv?.id ?? null };
}

// ── フォーム回答状況 ──────────────────────────────────────────
export interface MemberSubmission {
  id: number;
  formId: number;
  formName: string;
  status: SubmissionStatus;
  submittedAt: string;
  /** 回答の先頭数件を1行サマリーにしたもの */
  summary: string;
}

/** そのメンバーが回答したフォームの一覧（新しい順） */
export async function fetchMemberSubmissions(memberId: number): Promise<MemberSubmission[]> {
  const { data: subs } = await supabase
    .from("form_submissions")
    .select("id, form_id, status, submitted_at")
    .eq("member_id", memberId)
    .order("submitted_at", { ascending: false });
  if (!subs || subs.length === 0) return [];

  const formIds = Array.from(new Set(subs.map((s) => s.form_id)));
  const subIds  = subs.map((s) => s.id);

  const [{ data: forms }, { data: answers }] = await Promise.all([
    supabase.from("forms").select("id, name").in("id", formIds),
    supabase.from("form_answers").select("submission_id, value, value_list").in("submission_id", subIds),
  ]);

  const nameOf = new Map((forms ?? []).map((f) => [f.id, f.name]));
  const sumOf = new Map<number, string[]>();
  for (const a of answers ?? []) {
    const list = Array.isArray(a.value_list) ? (a.value_list as string[]) : [];
    const text = list.length ? list.join("、") : (a.value ?? "");
    if (!text.trim()) continue;
    const arr = sumOf.get(a.submission_id) ?? [];
    if (arr.length < 3) arr.push(text);
    sumOf.set(a.submission_id, arr);
  }

  return subs.map((s) => ({
    id: s.id,
    formId: s.form_id,
    formName: nameOf.get(s.form_id) ?? "（削除されたフォーム）",
    status: (s.status as SubmissionStatus) ?? "new",
    submittedAt: s.submitted_at ?? "",
    summary: (sumOf.get(s.id) ?? []).join(" ／ "),
  }));
}

/** そのメンバーがまだ回答していない公開中フォームの件数 */
export async function countUnansweredForms(memberId: number): Promise<number> {
  const [{ data: forms }, { data: subs }] = await Promise.all([
    supabase.from("forms").select("id").eq("status", "published"),
    supabase.from("form_submissions").select("form_id").eq("member_id", memberId),
  ]);
  const answered = new Set((subs ?? []).map((s) => s.form_id));
  return (forms ?? []).filter((f) => !answered.has(f.id)).length;
}

// ── 保存 ──────────────────────────────────────────────────────
export interface MemberBasicPatch {
  name: string;
  kana: string;
  email: string;
  tel: string;
  role: string;
  company: string;
  chatId: string;
  prefecture: string;
}

/**
 * 基本情報の保存。
 *   メールから Supabase アカウント（auth.users）を引いて user_id を紐づける
 *   のは従来のメンバー編集モーダルと同じ挙動。
 *
 *   ⚠️ 流入経路（source_id）はこの画面では扱わない。
 *      付与は「招待」と「公開フォームの ?src=」で自動的に行われる。
 */
export async function saveMemberBasic(id: number, p: MemberBasicPatch): Promise<string | null> {
  const email = p.email.trim();
  let userId: string | null = null;
  if (email) {
    const { data } = await supabase.rpc("get_user_id_by_email", { email_input: email });
    userId = (data as string | null) ?? null;
  }

  const { error } = await supabase.from("members").update({
    name: p.name.trim(),
    kana: p.kana.trim() || null,
    email: email || null,
    tel: p.tel.trim() || null,
    role: p.role as Member["role"],
    company: p.company.trim() || null,
    chat_id: p.chatId.trim() || null,
    prefecture: p.prefecture || null,
    user_id: userId,
  }).eq("id", id);

  return error ? error.message : null;
}

export async function softDeleteMember(id: number): Promise<string | null> {
  const { error } = await supabase.from("members").update({ is_deleted: true }).eq("id", id);
  return error ? error.message : null;
}

// ── チャット要約（毎回生成・DB には保存しない）────────────────
export interface ChatSummary {
  text: string;
  /** 要約対象のメッセージ件数（表示用） */
  messageCount: number;
  generatedAt: string;
}

/** 要約対象のメッセージ件数（「対象 N 件」の表示用） */
export async function countChatMessages(conversationId: number): Promise<number> {
  const { count } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  return count ?? 0;
}
