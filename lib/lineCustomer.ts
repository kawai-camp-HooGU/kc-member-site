// ============================================================
// LINE顧客（会員未連携）の詳細：会員と同じUIで管理するための取得・保存
//   ・共通プロフィール（氏名・フリガナ・メール・電話）は line_friends の
//     collected_* に保存（表示名 display_name は LINE 提供値＝読み取り専用）。
//   ・属性ABC / メモ は member_attributes / member_memos に friend_id で保存
//     （会員と同じマスタ・同じ明細構造を共有）。
//
//   ⚠️ 運営専用（line_friends / member_* は RLS=is_ops / authenticated）。
// ============================================================
import { supabase } from "./supabase";
import type { MemberMemo } from "./models";

export interface LineCustomerProfile {
  friendId: number;
  displayName: string;          // LINE表示名（読み取り専用）
  lineUserId: string;
  status: string;               // friend | blocked | unfollowed
  accountId: number | null;
  memberId: number | null;      // 連携済みならその会員ID
  // 編集可能な共通項目（line_friends.collected_*）
  name: string;                 // 氏名
  kana: string;
  email: string;
  phone: string;
}

export interface LineCustomerDetail {
  profile: LineCustomerProfile;
  attrIds: number[];
  memos: MemberMemo[];
}

export interface LineCustomerPatch {
  name: string; kana: string; email: string; phone: string;
}

// ── 取得 ──────────────────────────────────────────────────────
export async function fetchLineCustomerDetail(friendId: number): Promise<LineCustomerDetail | null> {
  const [{ data: f }, { data: attrs }, { data: memos }] = await Promise.all([
    supabase.from("line_friends")
      .select("id, display_name, line_user_id, status, account_id, member_id, collected_name, collected_kana, collected_email, collected_phone")
      .eq("id", friendId).maybeSingle(),
    supabase.from("member_attributes").select("attribute_id").eq("friend_id", friendId),
    supabase.from("member_memos").select("*").eq("friend_id", friendId).order("sort_order"),
  ]);
  if (!f) return null;

  return {
    profile: {
      friendId: f.id,
      displayName: f.display_name ?? "",
      lineUserId: f.line_user_id ?? "",
      status: f.status ?? "",
      accountId: f.account_id ?? null,
      memberId: f.member_id ?? null,
      name: f.collected_name ?? "",
      kana: f.collected_kana ?? "",
      email: f.collected_email ?? "",
      phone: f.collected_phone ?? "",
    },
    attrIds: (attrs ?? []).map((a) => a.attribute_id),
    memos: (memos ?? []).map((r): MemberMemo => ({
      id: r.id,
      titleId: r.title_id ?? null,
      title: r.title ?? "",
      body: r.body ?? "",
      source: r.source_kind === "form"
        ? { kind: "form", formId: r.source_form_id ?? null, formName: r.source_form_name ?? "", submissionId: r.source_submission_id ?? null }
        : { kind: "manual" },
      updatedAt: r.updated_at ?? "",
    })),
  };
}

// ── 保存 ──────────────────────────────────────────────────────
/** LINE顧客の共通項目（line_friends.collected_*）を更新 */
export async function saveLineCustomerProfile(friendId: number, p: LineCustomerPatch): Promise<string | null> {
  const { error } = await supabase.from("line_friends").update({
    collected_name: p.name.trim(),
    collected_kana: p.kana.trim(),
    collected_email: p.email.trim(),
    collected_phone: p.phone.trim(),
  }).eq("id", friendId);
  return error ? error.message : null;
}

/** LINE顧客の属性・メモを保存（会員の saveMemberExtras の friend 版） */
export async function saveLineCustomerExtras(friendId: number, attrIds: number[], memos: MemberMemo[]): Promise<void> {
  await supabase.from("member_attributes").delete().eq("friend_id", friendId);
  if (attrIds.length) {
    await supabase.from("member_attributes").insert(
      attrIds.map((id) => ({ friend_id: friendId, attribute_id: id })),
    );
  }
  await supabase.from("member_memos").delete().eq("friend_id", friendId);
  if (memos.length) {
    await supabase.from("member_memos").insert(memos.map((mo, i) => ({
      friend_id: friendId,
      title_id: mo.titleId ?? null,
      title: mo.title ?? "",
      body: mo.body,
      source_kind:          mo.source?.kind === "form" ? "form" : "manual",
      source_form_id:       mo.source?.kind === "form" ? mo.source.formId : null,
      source_form_name:     mo.source?.kind === "form" ? mo.source.formName : "",
      source_submission_id: mo.source?.kind === "form" ? mo.source.submissionId : null,
      sort_order: i,
      updated_at: mo.updatedAt || new Date().toISOString(),
    })));
  }
}
