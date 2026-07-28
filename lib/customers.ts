// ============================================================
// 顧客（データ種別・LINE統合名寄せ）：クライアント取得
//   ・fetchCustomers   … v_customers（会員 ∪ LINE）を種別・状態で取得
//   ・buildMergePreview … 統合実行前の項目差分（会員=親 / LINE=子）
//   ・fetchMergeHistory … 会員に紐づく統合履歴（customer_merge_history）
//
//   ⚠️ いずれも運営専用（v_customers / line_friends / customer_merge_history は RLS=is_ops）。
//      会員クライアントからは import しない。
// ============================================================
import { supabase } from "./supabase";
import type { Tables, Views } from "./database.types";
import type {
  Customer, CustomerKind, MergePreview, MergeFieldDiff, CustomerMergeHistory,
} from "./models";

// ── 顧客一覧（v_customers）─────────────────────────────────────
export interface CustomerFilter {
  kind?: CustomerKind | "all";
  accountId?: number | null;   // LINE公式アカウント絞り込み
  status?: "all" | "active" | "merged";
  keyword?: string;
}

function toCustomer(r: Views<"v_customers">): Customer {
  return {
    dataKind: (r.data_kind === "line" ? "line" : "member"),
    memberId: r.member_id,
    friendId: r.friend_id,
    lineAccountId: r.line_account_id,
    lineUserId: r.line_user_id,
    displayName: r.display_name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    status: (r.status === "merged" ? "merged" : "active"),
    createdAt: r.created_at ?? "",
  };
}

export async function fetchCustomers(f: CustomerFilter = {}): Promise<Customer[]> {
  let q = supabase.from("v_customers").select("*");
  if (f.kind && f.kind !== "all") q = q.eq("data_kind", f.kind);
  if (f.accountId != null) q = q.eq("line_account_id", f.accountId);
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error || !data) return [];
  let rows = data.map(toCustomer);
  const kw = (f.keyword ?? "").trim().toLowerCase();
  if (kw) {
    rows = rows.filter((c) =>
      c.displayName.toLowerCase().includes(kw) ||
      c.email.toLowerCase().includes(kw) ||
      c.phone.includes(kw));
  }
  return rows;
}

// ── 統合プレビュー（実行前の差分）─────────────────────────────
const FIELD_LABEL: Record<MergeFieldDiff["field"], string> = {
  kana: "フリガナ", email: "メール", tel: "電話", line_user_id: "LINE識別子",
};

export async function buildMergePreview(friendId: number, memberId: number): Promise<MergePreview | null> {
  const [{ data: friend }, { data: member }] = await Promise.all([
    supabase.from("line_friends")
      .select("id, line_user_id, display_name, collected_kana, collected_email, collected_phone")
      .eq("id", friendId).maybeSingle(),
    // 会員(親)の現在値。line_user_id は members_visible に無いため raw members を参照（運営のみ読める）。
    supabase.from("members")
      .select("id, name, kana, email, tel, line_user_id")
      .eq("id", memberId).maybeSingle(),
  ]);
  if (!friend || !member) return null;

  const isEmpty = (v: string | null | undefined) => v == null || v.trim() === "";
  const mk = (
    field: MergeFieldDiff["field"], parent: string | null | undefined, child: string | null | undefined,
  ): MergeFieldDiff => {
    const p = (parent ?? "").trim();
    const c = (child ?? "").trim();
    return { field, label: FIELD_LABEL[field], parentValue: p, childValue: c, willFill: isEmpty(p) && c !== "" };
  };

  const diffs: MergeFieldDiff[] = [
    mk("kana", member.kana, friend.collected_kana),
    mk("email", member.email, friend.collected_email),
    mk("tel", member.tel, friend.collected_phone),
    mk("line_user_id", member.line_user_id, friend.line_user_id),
  ];

  return {
    friendId, memberId,
    memberName: member.name ?? "",
    lineDisplayName: friend.display_name ?? "",
    diffs,
  };
}

// ── 統合履歴 ──────────────────────────────────────────────────
function toHistory(r: Tables<"customer_merge_history">): CustomerMergeHistory {
  return {
    id: r.id,
    memberId: r.member_id,
    friendId: r.friend_id,
    field: r.field,
    oldValue: r.old_value ?? "",
    newValue: r.new_value ?? "",
    sourceKind: r.source_kind,
    matchedBy: r.matched_by ?? "",
    mergedBy: r.merged_by,
    action: (r.action === "unmerge" ? "unmerge" : "merge"),
    createdAt: r.created_at,
  };
}

/** 会員に紐づく統合履歴（新しい順） */
export async function fetchMergeHistory(memberId: number): Promise<CustomerMergeHistory[]> {
  const { data, error } = await supabase
    .from("customer_merge_history")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(toHistory);
}

export const MERGE_FIELD_LABEL = FIELD_LABEL;
