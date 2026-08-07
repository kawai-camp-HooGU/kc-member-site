// ============================================================
// LIFF連携（Phase 5・サーバー専用）
//   ・liff-config：アカウントの LIFF ID（公開値）を返す。
//   ・liff-link  ：LIFFで得た本人情報＋入力情報を保存し、会員照合まで実行。
//   ・my-page    ：LINE内の会員マイページに表示する本人プロフィールを返す（Phase 5c）。
//
//   本人特定（userId）の扱い：
//     アカウントに login_channel_id（LINEログインチャネルID）が設定されていれば、
//     LIFFの ID トークンをLINEに検証させて sub(userId) を得る（詐称防止）。
//     未設定なら LIFF コンテキストの userId を信頼する（フォーム保存のみ・低リスク）。
//     ⚠️ マイページ（PII表示）は検証必須。未設定/失敗時は表示しない（fail-closed）。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { runMatch } from "./lineLinkServer";
import { fireSourceForFriend } from "./actionsServer";
import { applyRichMenuForFriend } from "./lineRichMenuServer";
import { verifyLiffIdToken } from "./lineClient";
import { loadAttrTree, loadMemberProfile } from "./ai/context";

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

/** アカウントの LINEログインチャネルID（IDトークン検証用）。未設定なら "".  */
async function getLoginChannelId(accountId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from("line_accounts")
    .select("login_channel_id")
    .eq("id", accountId)
    .maybeSingle();
  return data?.login_channel_id ?? "";
}

/**
 * 本人の userId を確定する。
 *   requireVerified=true（マイページ）：検証できなければ null（fail-closed）。
 *   requireVerified=false（フォーム保存）：検証できなければ fallbackUserId を信頼。
 */
async function resolveUserId(
  accountId: number,
  idToken: string | undefined,
  fallbackUserId: string | undefined,
  requireVerified: boolean
): Promise<{ userId: string } | { error: string }> {
  const channelId = await getLoginChannelId(accountId);
  if (channelId && idToken) {
    const v = await verifyLiffIdToken(idToken, channelId);
    if (v) return { userId: v.userId };
    if (requireVerified) return { error: "本人確認に失敗しました。LINEアプリから開き直してください。" };
  }
  if (requireVerified) {
    return { error: "このアカウントはマイページの本人確認が未設定です（LINEログインチャネルIDを登録してください）。" };
  }
  if (!fallbackUserId) return { error: "ユーザー情報を取得できませんでした" };
  return { userId: fallbackUserId };
}

/** LIFFフォームの回答を保存 → 会員照合。友だちは (account_id, userId) で特定。 */
export async function saveLiffCollectedAndMatch(
  accountId: number,
  fallbackUserId: string,
  input: { name?: string; kana?: string; email?: string; phone?: string },
  idToken?: string
): Promise<{ ok: boolean; error?: string; linked?: boolean }> {
  const r = await resolveUserId(accountId, idToken, fallbackUserId, false);
  if ("error" in r) return { ok: false, error: r.error };
  const userId = r.userId;

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

// ── 流入経路の付与（LINE入口・Phase 6）───────────────────────
/**
 * LIFF入口（?s=経路キー）から友だちに流入経路を付与し、経路アクションを発火する。
 *   ・友だち行を (account_id, userId) で用意（follow前でもLIFFで作れる）。
 *   ・source_id は「空のときだけ」書き込む＝ファーストタッチ（初回経路を上書きしない）。
 *   ・付与後に fireSourceForFriend：未連携なら属性のみ、連携済みなら会員へ全アクション。
 *   本人特定は resolveUserId（ログインチャネルID設定時は IDトークン検証、未設定は userId 信頼）。
 */
export async function attachFriendSource(
  accountId: number,
  fallbackUserId: string,
  sourceKey: string,
  idToken?: string
): Promise<{ ok: boolean; error?: string }> {
  const key = (sourceKey ?? "").trim();
  if (!key) return { ok: false, error: "経路キーが指定されていません" };

  const r = await resolveUserId(accountId, idToken, fallbackUserId, false);
  if ("error" in r) return { ok: false, error: r.error };
  const userId = r.userId;

  // 有効な経路だけ（停止/削除は付与しない）
  const { data: src } = await supabaseAdmin
    .from("sources").select("id, is_active")
    .eq("key", key).eq("is_deleted", false).maybeSingle();
  if (!src || !src.is_active) return { ok: false, error: "経路が見つかりません" };

  // 友だち行を用意
  await supabaseAdmin.from("line_friends").upsert(
    { account_id: accountId, line_user_id: userId },
    { onConflict: "account_id,line_user_id", ignoreDuplicates: false }
  );

  // ファーストタッチ：source_id が空のときだけ書き込む。更新できたか（＝初回）を .select で判定。
  const { data: touched } = await supabaseAdmin.from("line_friends")
    .update({ source_id: src.id })
    .eq("account_id", accountId).eq("line_user_id", userId).is("source_id", null)
    .select("id");
  const firstTouch = (touched?.length ?? 0) > 0;

  // 初回付与時のみアクション発火（LIFF再オープンでの多重送信を防ぐ）。
  //   未連携＝属性付与＋（設定あれば）LINEメッセージ／連携済＝会員へ（台帳で冪等）。
  if (firstTouch && touched && touched[0]) {
    await fireSourceForFriend(touched[0].id);
  }

  // リッチメニューの出し分けを反映（Phase 7②）。
  const { data: fr } = await supabaseAdmin.from("line_friends")
    .select("id").eq("account_id", accountId).eq("line_user_id", userId).maybeSingle();
  if (fr) await applyRichMenuForFriend(fr.id);

  return { ok: true };
}

// ── マイページ（Phase 5c）────────────────────────────────────
export interface MyPageData {
  linked: boolean;
  accountName: string;
  displayName: string;      // LINE表示名（未連携でも出せる）
  member?: {
    name: string;
    company: string;
    source: string;
    prefecture: string;
    createdAt: string;
    attrLabels: string[];
  };
}

/**
 * LINE内マイページに出す本人プロフィール。
 *   ・本人特定は IDトークン検証（必須）。
 *   ・会員に連携済みなら会員プロフィールを返す（内部メモは出さない）。
 *   ・未連携なら linked:false（フォームへ誘導する）。
 */
export async function getMyPage(
  accountId: number,
  fallbackUserId: string | undefined,
  idToken: string | undefined
): Promise<{ ok: boolean; error?: string; data?: MyPageData }> {
  const acc = await supabaseAdmin
    .from("line_accounts")
    .select("name, is_deleted")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc.data || acc.data.is_deleted) return { ok: false, error: "アカウントが見つかりません" };
  const accountName = acc.data.name ?? "";

  const r = await resolveUserId(accountId, idToken, fallbackUserId, true);
  if ("error" in r) return { ok: false, error: r.error };
  const userId = r.userId;

  const { data: friend } = await supabaseAdmin
    .from("line_friends")
    .select("member_id, display_name, collected_name")
    .eq("account_id", accountId)
    .eq("line_user_id", userId)
    .maybeSingle();

  const displayName = friend?.display_name || friend?.collected_name || "";

  if (!friend || friend.member_id == null) {
    return { ok: true, data: { linked: false, accountName, displayName } };
  }

  const tree = await loadAttrTree();
  const profile = await loadMemberProfile(friend.member_id, tree);
  if (!profile) return { ok: true, data: { linked: false, accountName, displayName } };

  return {
    ok: true,
    data: {
      linked: true,
      accountName,
      displayName: displayName || profile.name,
      member: {
        name: profile.name,
        company: profile.company,
        source: profile.source,
        prefecture: profile.prefecture,
        createdAt: profile.createdAt,
        attrLabels: profile.attrLabels,   // 内部メモ(memos)は意図的に除外
      },
    },
  };
}
