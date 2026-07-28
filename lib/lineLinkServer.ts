// ============================================================
// LINE名寄せ サーバー処理（service_role / サーバー専用）
//   ・登録フォームで集めた本人情報 → 会員照合（②メール ③電話 一意で自動連携／④氏名は候補）
//   ・自動連携は「ちょうど1会員に一致」かつ「その会員が未連携」のときだけ。1会員=1LINE。
//   ・連携/解除は line_link_audit に証跡を残す。
//   ⚠️ ① userId は照合キーではない（連携結果の書き込み先としてのみ使う）。
// ============================================================
import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { errMessage } from "./errors";
import { normEmail, normPhone, normName } from "./lineMatch";
import type { LineMatchCandidate, LineMatchResult, LineLinkQueueItem, LineLinkCategory } from "./models";

interface FriendRow {
  id: number; line_user_id: string; member_id: number | null;
  collected_name: string | null; collected_kana: string | null;
  collected_email: string | null; collected_phone: string | null;
}
interface MemberRow {
  id: number; name: string | null; kana: string | null;
  email: string | null; tel: string | null; line_user_id: string | null;
}

async function getFriend(friendId: number): Promise<FriendRow | null> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("id, line_user_id, member_id, collected_name, collected_kana, collected_email, collected_phone")
    .eq("id", friendId)
    .maybeSingle();
  return data ?? null;
}

// ── 照合 ──────────────────────────────────────────────────────
/**
 * 収集済みの本人情報で会員を照合する。②③が一意なら自動連携し、結果を返す。
 * 既に連携済みの友だちは何もしない。
 */
export async function runMatch(friendId: number, linkedBy = "auto"): Promise<LineMatchResult> {
  const empty: LineMatchResult = { linked: false, linkedMemberId: null, linkedBy: null, conflict: false, candidates: [] };
  const friend = await getFriend(friendId);
  if (!friend) return empty;
  if (friend.member_id != null) {
    return { ...empty, linked: true, linkedMemberId: friend.member_id };
  }

  const cEmail = normEmail(friend.collected_email);
  const cPhone = normPhone(friend.collected_phone);
  const cName = normName(friend.collected_name);
  if (!cEmail && !cPhone && !cName) return empty;

  const { data: rows } = await supabaseAdmin
    .from("members")
    .select("id, name, kana, email, tel, line_user_id")
    .eq("is_deleted", false);
  const members = (rows ?? []) as MemberRow[];

  const emailIds = new Set<number>();
  const phoneIds = new Set<number>();
  const nameIds = new Set<number>();
  for (const m of members) {
    if (cEmail && normEmail(m.email) === cEmail) emailIds.add(m.id);
    if (cPhone && normPhone(m.tel) === cPhone) phoneIds.add(m.id);
    if (cName && normName(m.name) === cName) nameIds.add(m.id);
  }

  // 候補（②③④の和集合）を組み立て
  const unionIds = new Set<number>([...emailIds, ...phoneIds, ...nameIds]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const candidates: LineMatchCandidate[] = [...unionIds].map((id) => {
    const m = byId.get(id) as MemberRow;
    const matchedBy: ("email" | "phone" | "name")[] = [];
    if (emailIds.has(id)) matchedBy.push("email");
    if (phoneIds.has(id)) matchedBy.push("phone");
    if (nameIds.has(id)) matchedBy.push("name");
    return {
      memberId: id,
      name: m.name ?? "",
      email: m.email ?? "",
      tel: m.tel ?? "",
      matchedBy,
      alreadyLinked: !!m.line_user_id && m.line_user_id !== friend.line_user_id,
    };
  });

  // 強いキー（②③）で一意一致かを判定
  const strongIds = new Set<number>([...emailIds, ...phoneIds]);
  if (strongIds.size === 1) {
    const theId = [...strongIds][0];
    const target = byId.get(theId) as MemberRow;
    if (target.line_user_id && target.line_user_id !== friend.line_user_id) {
      // 会員が既に別LINEに連携済み ＝ 重複の疑い → 自動せず候補提示
      return { linked: false, linkedMemberId: null, linkedBy: null, conflict: true, candidates };
    }
    const matchedKey: "email" | "phone" = emailIds.has(theId) ? "email" : "phone";
    const ok = await doLink(friend, theId, matchedKey, linkedBy);
    if (ok) return { linked: true, linkedMemberId: theId, linkedBy: matchedKey, conflict: false, candidates };
    return { linked: false, linkedMemberId: null, linkedBy: null, conflict: false, candidates };
  }

  // 複数一致（②③がばらつく or 同キーで複数）→ コンフリクト扱いで手動へ
  const conflict = strongIds.size > 1;
  return { linked: false, linkedMemberId: null, linkedBy: null, conflict, candidates };
}

// ── 案B：名寄せキュー（読み取り専用・自動連携しない）──────────
interface MemberLite { id: number; name: string | null; email: string | null; tel: string | null; line_user_id: string | null }

/** 未連携の友だちを照合し、種類別に分類したキューを返す（副作用なし）。 */
export async function buildLinkQueue(accountId?: number | null): Promise<LineLinkQueueItem[]> {
  let q = supabaseAdmin
    .from("line_friends")
    .select("id, account_id, line_user_id, display_name, collected_name, collected_email, collected_phone")
    .is("member_id", null)
    .eq("status", "friend");
  if (accountId != null) q = q.eq("account_id", accountId);
  const { data: friends } = await q;
  if (!friends || friends.length === 0) return [];

  const { data: mrows } = await supabaseAdmin
    .from("members").select("id, name, email, tel, line_user_id").eq("is_deleted", false);
  const members = (mrows ?? []) as MemberLite[];

  return friends.map((f) => {
    const cEmail = normEmail(f.collected_email);
    const cPhone = normPhone(f.collected_phone);
    const cName = normName(f.collected_name);

    const emailIds = new Set<number>(), phoneIds = new Set<number>(), nameIds = new Set<number>();
    for (const m of members) {
      if (cEmail && normEmail(m.email) === cEmail) emailIds.add(m.id);
      if (cPhone && normPhone(m.tel) === cPhone) phoneIds.add(m.id);
      if (cName && normName(m.name) === cName) nameIds.add(m.id);
    }
    const unionIds = new Set<number>([...emailIds, ...phoneIds, ...nameIds]);
    const byId = new Map(members.map((m) => [m.id, m]));
    const candidates: LineMatchCandidate[] = [...unionIds].map((id) => {
      const m = byId.get(id) as MemberLite;
      const matchedBy: ("email" | "phone" | "name")[] = [];
      if (emailIds.has(id)) matchedBy.push("email");
      if (phoneIds.has(id)) matchedBy.push("phone");
      if (nameIds.has(id)) matchedBy.push("name");
      return {
        memberId: id, name: m.name ?? "", email: m.email ?? "", tel: m.tel ?? "",
        matchedBy, alreadyLinked: !!m.line_user_id && m.line_user_id !== f.line_user_id,
      };
    });

    const strongIds = new Set<number>([...emailIds, ...phoneIds]);
    let category: LineLinkCategory;
    let autoMemberId: number | null = null;
    if (strongIds.size === 1) {
      const id = [...strongIds][0];
      const target = byId.get(id) as MemberLite;
      if (target.line_user_id && target.line_user_id !== f.line_user_id) category = "duplicate";
      else { category = "ready"; autoMemberId = id; }
    } else if (strongIds.size > 1) {
      category = "conflict";
    } else if (nameIds.size > 0) {
      category = "name";
    } else {
      category = "pending";
    }

    return {
      friendId: f.id,
      displayName: f.display_name ?? "",
      accountId: f.account_id,
      collectedName: f.collected_name ?? "",
      collectedEmail: f.collected_email ?? "",
      collectedPhone: f.collected_phone ?? "",
      category,
      autoMemberId,
      candidates,
    };
  });
}

// ── 連携＝統合の実行 ──────────────────────────────────────────
//   会員(親)へ LINE(子) を紐づけ、会員の「空いている項目だけ」を collected_* で
//   非破壊補完する。補完した項目は customer_merge_history に1件ずつ残す。
//   ⚠️ 方向は常に「子(LINE) → 親(会員)」。会員に既に値がある項目は上書きしない。
async function doLink(
  friend: FriendRow, memberId: number, matchedBy: string, linkedBy: string
): Promise<boolean> {
  try {
    // 親（会員）の現在値を取得して、補完対象を判定する
    const { data: member } = await supabaseAdmin
      .from("members")
      .select("id, kana, email, tel, line_user_id")
      .eq("id", memberId)
      .maybeSingle();
    if (!member) throw new Error("member not found");

    const isEmpty = (v: string | null | undefined) => v == null || v.trim() === "";
    const now = new Date().toISOString();

    // 補完候補：親が空 かつ 子に値がある 項目だけ（非破壊）
    const fills: { field: string; from: string | null; to: string }[] = [];
    const memberPatch: Record<string, string> = {};
    const consider = (field: "kana" | "email" | "tel", current: string | null, collected: string | null) => {
      const val = (collected ?? "").trim();
      if (isEmpty(current) && val !== "") {
        memberPatch[field] = val;
        fills.push({ field, from: current ?? null, to: val });
      }
    };
    consider("kana", member.kana, friend.collected_kana);
    consider("email", member.email, friend.collected_email);
    consider("tel", member.tel, friend.collected_phone);

    // 1会員=1LINE：LINE識別子を親へ付与（＋補完項目をまとめて更新）
    const { error: mErr } = await supabaseAdmin
      .from("members")
      .update({ ...memberPatch, line_user_id: friend.line_user_id, line_linked_at: now })
      .eq("id", memberId);
    if (mErr) throw mErr;

    const { error: fErr } = await supabaseAdmin
      .from("line_friends")
      .update({ member_id: memberId })
      .eq("id", friend.id);
    if (fErr) throw fErr;

    // 連携事実（従来どおり line_link_audit）
    await supabaseAdmin.from("line_link_audit").insert({
      friend_id: friend.id, member_id: memberId, matched_by: matchedBy, linked_by: linkedBy, action: "link",
    });

    // 項目単位の統合履歴（何が・どの値で・どのソースから）
    const historyRows = [
      ...fills.map((f) => ({
        member_id: memberId, friend_id: friend.id, field: f.field,
        old_value: f.from, new_value: f.to,
        source_kind: "line", matched_by: matchedBy, merged_by: linkedBy, action: "merge",
      })),
    ];
    // LINE識別子の付与も履歴に残す（会員が未連携だった場合）
    if (isEmpty(member.line_user_id)) {
      historyRows.push({
        member_id: memberId, friend_id: friend.id, field: "line_user_id",
        old_value: member.line_user_id ?? null, new_value: friend.line_user_id,
        source_kind: "line", matched_by: matchedBy, merged_by: linkedBy, action: "merge",
      });
    }
    if (historyRows.length) {
      await supabaseAdmin.from("customer_merge_history").insert(historyRows);
    }
    return true;
  } catch (e) {
    console.error("doLink error:", errMessage(e));
    return false;
  }
}

/** 手動連携（人が確定）。会員が既に別LINEに連携済みなら拒否。 */
export async function manualLink(
  friendId: number, memberId: number, byMemberId: number | null
): Promise<{ ok: boolean; error?: string }> {
  const friend = await getFriend(friendId);
  if (!friend) return { ok: false, error: "友だちが見つかりません" };
  if (friend.member_id != null) return { ok: false, error: "この友だちは既に連携済みです" };
  const { data: target } = await supabaseAdmin
    .from("members").select("id, line_user_id, is_deleted").eq("id", memberId).maybeSingle();
  if (!target || target.is_deleted) return { ok: false, error: "会員が見つかりません" };
  if (target.line_user_id && target.line_user_id !== friend.line_user_id) {
    return { ok: false, error: "この会員は既に別のLINEに連携済みです" };
  }
  const ok = await doLink(friend, memberId, "manual", byMemberId != null ? String(byMemberId) : "manual");
  return ok ? { ok: true } : { ok: false, error: "連携に失敗しました" };
}

/** 連携解除。 */
export async function unlink(friendId: number, byMemberId: number | null): Promise<{ ok: boolean; error?: string }> {
  const friend = await getFriend(friendId);
  if (!friend) return { ok: false, error: "友だちが見つかりません" };
  const memberId = friend.member_id;
  try {
    await supabaseAdmin.from("line_friends").update({ member_id: null }).eq("id", friendId);
    if (memberId != null) {
      await supabaseAdmin
        .from("members")
        .update({ line_user_id: null, line_linked_at: null })
        .eq("id", memberId)
        .eq("line_user_id", friend.line_user_id);
    }
    await supabaseAdmin.from("line_link_audit").insert({
      friend_id: friendId, member_id: memberId, matched_by: "manual",
      linked_by: byMemberId != null ? String(byMemberId) : "manual", action: "unlink",
    });
    // 統合解除も履歴に残す（LINE識別子の切り離し。補完済み項目は自動では戻さない＝運営判断）
    if (memberId != null) {
      await supabaseAdmin.from("customer_merge_history").insert({
        member_id: memberId, friend_id: friendId, field: "line_user_id",
        old_value: friend.line_user_id, new_value: null,
        source_kind: "line", matched_by: "manual",
        merged_by: byMemberId != null ? String(byMemberId) : "manual", action: "unmerge",
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

// ── 登録フォーム（トークンで友だちを特定）──────────────────────
/** 友だちのフォーム用トークンを用意（無ければ発行）して返す。 */
export async function ensureLinkToken(friendId: number): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("line_friends").select("link_token").eq("id", friendId).maybeSingle();
  if (data?.link_token) return data.link_token;
  const token = crypto.randomUUID().replace(/-/g, "");
  const { error } = await supabaseAdmin
    .from("line_friends").update({ link_token: token }).eq("id", friendId);
  if (error) return null;
  return token;
}

/** トークン → 友だち（フォーム表示・保存で使用）。 */
export async function resolveFriendByToken(
  token: string
): Promise<{ id: number; displayName: string; collectedEmail: string } | null> {
  const { data } = await supabaseAdmin
    .from("line_friends")
    .select("id, display_name, collected_email, member_id")
    .eq("link_token", token)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, displayName: data.display_name ?? "", collectedEmail: data.collected_email ?? "" };
}

/** フォーム回答を保存して照合まで行う（公開エンドポイントから呼ぶ）。 */
export async function saveCollectedAndMatch(
  token: string,
  input: { name?: string; kana?: string; email?: string; phone?: string }
): Promise<{ ok: boolean; error?: string; linked?: boolean }> {
  const friend = await resolveFriendByToken(token);
  if (!friend) return { ok: false, error: "リンクが無効です" };

  const { error } = await supabaseAdmin.from("line_friends").update({
    collected_name: (input.name ?? "").trim() || null,
    collected_kana: (input.kana ?? "").trim() || null,
    collected_email: (input.email ?? "").trim() || null,
    collected_phone: (input.phone ?? "").trim() || null,
    identity_source: "form",
    identity_at: new Date().toISOString(),
  }).eq("id", friend.id);
  if (error) return { ok: false, error: "保存に失敗しました" };

  const result = await runMatch(friend.id, "auto");
  return { ok: true, linked: result.linked };
}
