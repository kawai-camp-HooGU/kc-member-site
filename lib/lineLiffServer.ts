// ============================================================
// LIFF連携（Phase 5・サーバー専用）
//   ・liff-config：アカウントの LIFF ID（公開値）を返す。
//   ・liff-link  ：LIFFで得た userId ＋入力情報を保存し、会員照合まで実行。
//   ⚠️ userId は LIFF のコンテキスト由来。本番は ID トークン検証で強化する余地あり。
//      現状は「そのアカウントに既に存在する友だち（follow済み）」のみ更新できるよう限定。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { runMatch } from "./lineLinkServer";

/** アカウントの LIFF ID（公開値）を取得。無効/未設定なら null。 */
export async function getLiffConfig(
  accountId: number
): Promise<{ liffId: string; accountName: string } | null> {
  const { data } = await supabaseAdmin
    .from("line_accounts")
    .select("liff_id, name, is_deleted")
    .eq("id", accountId)
    .maybeSingle();
  if (!data || data.is_deleted || !data.liff_id) return null;
  return { liffId: data.liff_id, accountName: data.name ?? "" };
}

/** LIFFフォームの回答を保存 → 会員照合。友だちは (account_id, userId) で特定。 */
export async function saveLiffCollectedAndMatch(
  accountId: number,
  userId: string,
  input: { name?: string; kana?: string; email?: string; phone?: string }
): Promise<{ ok: boolean; error?: string; linked?: boolean }> {
  if (!userId) return { ok: false, error: "ユーザー情報を取得できませんでした" };

  const { data: friend } = await supabaseAdmin
    .from("line_friends")
    .select("id")
    .eq("account_id", accountId)
    .eq("line_user_id", userId)
    .maybeSingle();
  if (!friend) return { ok: false, error: "友だち登録が確認できません。先に公式アカウントを友だち追加してください。" };

  const { error } = await supabaseAdmin.from("line_friends").update({
    collected_name: (input.name ?? "").trim() || null,
    collected_kana: (input.kana ?? "").trim() || null,
    collected_email: (input.email ?? "").trim() || null,
    collected_phone: (input.phone ?? "").trim() || null,
    identity_source: "liff",
    identity_at: new Date().toISOString(),
  }).eq("id", friend.id);
  if (error) return { ok: false, error: "保存に失敗しました" };

  const result = await runMatch(friend.id, "auto");
  return { ok: true, linked: result.linked };
}
