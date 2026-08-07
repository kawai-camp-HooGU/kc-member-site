// ============================================================
// 配信停止リスト（クライアント：管理画面用）
//   運営が閲覧・手動追加・解除する。送信時の照合はサーバー側（suppressionServer）。
// ============================================================
import { supabase } from "./supabase";

export interface Suppression { id: number; email: string; reason: string; createdAt: string; }

export async function fetchSuppressions(): Promise<Suppression[]> {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, email: r.email, reason: r.reason ?? "", createdAt: r.created_at ?? "" }));
}

/** 手動追加（重複は無視）。email は小文字正規化して保存。 */
export async function addSuppression(email: string, reason = "手動追加"): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const { error } = await supabase
    .from("email_suppressions")
    .upsert({ email: e, reason }, { onConflict: "email", ignoreDuplicates: true });
  return !error;
}

/** 停止の解除（配信を再開できるようにする）。 */
export async function removeSuppression(id: number): Promise<boolean> {
  const { error } = await supabase.from("email_suppressions").delete().eq("id", id);
  return !error;
}
