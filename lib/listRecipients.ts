// ============================================================
// リストを配信先にしたときの宛先解決と除外内訳
//   配信画面の「この設定で送られるのは N 件です」を算出する。
//
//   ⚠️ Phase 3a では**下書き保存と件数表示まで**。実送信は解禁していない
//      （lib/broadcastSend.ts が target_mode='list' を明示的に拒否する）。
//      Phase 3b でサーバー側から同じ規則で解決するときも、除外の定義は
//      ここと一致させること（画面の予告件数と実績が食い違うと事故になる）。
//
//   除外の内訳（設計書 図3-6）
//     ・メールアドレスなし（電話のみ）… メール配信できない
//     ・配信停止リストに登録         … email_suppressions と突合
//     ・リスト間の重複               … 同じ人に2通送らない（既定オン）
//     ・形式が不正                   … email_norm が作れなかったもの
// ============================================================
import { supabase } from "./supabase";
import type { ContactList } from "./models";
import { chunked, IN_CHUNK, fetchSuppressedSet, normalizeEmail } from "./contactLists";
import { resolveContact } from "./listMemberState";
import type { MemberContact } from "./listMemberState";

/** 1件の宛先（メール配信の単位） */
export interface ListRecipient {
  /** 実際に送るアドレス（生の値） */
  email: string;
  /** 重複判定に使う正規化値 */
  emailNorm: string;
  name: string;
  memberId: number | null;
  /** どのリスト由来か（最初に見つかったもの） */
  listId: number;
  /** 会員の最新アドレスに差し替えたか（確定事項 A2） */
  usedMemberEmail: boolean;
}

export interface ExcludedBreakdown {
  /** メールアドレスを持たない（電話のみ） */
  phoneOnly: number;
  /** 配信停止リストに登録されている */
  suppressed: number;
  /** 複数リストで重複していて1通にまとめた分 */
  dup: number;
  /** メールアドレスの形式が不正 */
  invalid: number;
  /** 退会（論理削除）した会員のため対象外（確定事項 A3） */
  withdrawn: number;
}

export interface ListAudience {
  /** 対象（選択したリストのレコード総数） */
  targetCount: number;
  /** 実際に送られる件数 */
  sendCount: number;
  excludedCount: number;
  breakdown: ExcludedBreakdown;
  recipients: ListRecipient[];
}

export const EMPTY_AUDIENCE: ListAudience = {
  targetCount: 0, sendCount: 0, excludedCount: 0,
  breakdown: { phoneOnly: 0, suppressed: 0, dup: 0, invalid: 0, withdrawn: 0 },
  recipients: [],
};

/** 配信先として選べるリストか（アーカイブ済み・配信対象外・メール0件は選べない） */
export function isSelectableForDelivery(l: ContactList): boolean {
  return !l.isDeleted && !l.isArchived && l.allowDelivery && l.emailableCount > 0;
}

/** 選べない理由（画面に出す。選んでから気づく事故を防ぐ） */
export function unselectableReason(l: ContactList): string {
  if (l.isArchived) return "アーカイブ済み";
  if (!l.allowDelivery) return "配信対象外の設定";
  if (l.emailableCount === 0) return "メールアドレスを持つレコードが 0 件";
  return "";
}

/**
 * 選択したリストからメール配信の宛先を解決する。
 *
 * ⚠️ 大量件数を想定して1000件ずつページングで読む。
 *    件数表示のためだけに全件をメモリに載せるのは避けたいが、
 *    「誰に送るか」を確定しないと重複排除ができないため、
 *    メールを持つレコードだけを読む（電話のみの行は件数キャッシュから数える）。
 */
export async function resolveListAudience(
  listIds: number[],
  lists: ContactList[],
  dedupe: boolean,
): Promise<ListAudience> {
  if (listIds.length === 0) return EMPTY_AUDIENCE;

  const chosen = lists.filter((l) => listIds.includes(l.id));
  const targetCount = chosen.reduce((s, l) => s + l.entryCount, 0);
  const phoneOnly = chosen.reduce((s, l) => s + l.phoneOnlyCount, 0);

  const suppressedSet = await fetchSuppressedSet();

  // ① まずレコードを読む（会員の解決は件数が確定してから一括で行う）
  interface RawEntry { email: string; emailNorm: string; name: string; memberId: number | null; listId: number }
  const raws: RawEntry[] = [];
  for (const listId of listIds) {
    let cursor: number | null = null;
    for (;;) {
      let q = supabase
        .from("contact_list_entries")
        .select("id, email, email_norm, name, member_id")
        .eq("list_id", listId)
        .not("email_norm", "is", null)
        .order("id", { ascending: false })
        .limit(1000);
      if (cursor != null) q = q.lt("id", cursor);

      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        raws.push({
          email: (r.email ?? "").trim(), emailNorm: r.email_norm ?? "",
          name: r.name ?? "", memberId: r.member_id ?? null, listId,
        });
      }
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
  }

  // ② 紐づく会員をまとめて引く（A2：最新アドレス／A3：退会判定に使う）
  const memberMap = await fetchMemberContacts(
    Array.from(new Set(raws.map((r) => r.memberId).filter((v): v is number => v != null))),
  );

  const recipients: ListRecipient[] = [];
  const seen = new Set<string>();
  let suppressed = 0;
  let dup = 0;
  let invalid = 0;
  let withdrawn = 0;

  for (const r of raws) {
    if (!r.emailNorm || !r.email || !normalizeEmail(r.email)) { invalid += 1; continue; }
    const c = resolveContact(r.email, r.emailNorm, r.memberId != null ? memberMap.get(r.memberId) : null);
    if (c.withdrawn) { withdrawn += 1; continue; }              // A3
    if (suppressedSet.has(c.emailNorm)) { suppressed += 1; continue; }
    // ⚠️ 重複判定は「実際に送るアドレス」で行う。会員の最新アドレスに
    //    差し替えた結果として重複することがある（A2）。
    if (dedupe && seen.has(c.emailNorm)) { dup += 1; continue; }
    seen.add(c.emailNorm);
    recipients.push({
      email: c.email, emailNorm: c.emailNorm, name: r.name,
      memberId: r.memberId, listId: r.listId, usedMemberEmail: c.usedMemberEmail,
    });
  }

  const breakdown: ExcludedBreakdown = { phoneOnly, suppressed, dup, invalid, withdrawn };
  const excludedCount = phoneOnly + suppressed + dup + invalid + withdrawn;
  return {
    targetCount,
    sendCount: recipients.length,
    excludedCount,
    breakdown,
    recipients,
  };
}

/**
 * 件数だけを軽く数える（宛先の中身は要らない場面用）。
 * ⚠️ 重複排除の正確な件数は実データを見ないと出せないため、
 *    dedupe=true のときは resolveListAudience() を使うこと。
 */
export async function countEmailable(listIds: number[]): Promise<number> {
  if (listIds.length === 0) return 0;
  let total = 0;
  for (const chunk of chunked(listIds, IN_CHUNK)) {
    const { count } = await supabase
      .from("contact_list_entries")
      .select("id", { count: "exact", head: true })
      .in("list_id", chunk)
      .not("email_norm", "is", null);
    total += count ?? 0;
  }
  return total;
}

/**
 * 紐づく会員の情報をまとめて引く（A2/A3 の判定に使う）。
 * ⚠️ in() はURL長の制限があるため分割して引く。
 */
export async function fetchMemberContacts(memberIds: number[]): Promise<Map<number, MemberContact>> {
  const map = new Map<number, MemberContact>();
  if (memberIds.length === 0) return map;
  for (const chunk of chunked(memberIds, IN_CHUNK)) {
    const { data } = await supabase.from("members").select("id, email, is_deleted").in("id", chunk);
    for (const m of data ?? []) {
      map.set(m.id, { id: m.id, email: m.email ?? "", isDeleted: m.is_deleted ?? false });
    }
  }
  return map;
}

/** 退会（論理削除）した会員IDの集合。レコード一覧の状態表示に使う。 */
export async function fetchWithdrawnMemberIds(memberIds: number[]): Promise<Set<number>> {
  const map = await fetchMemberContacts(memberIds);
  const out = new Set<number>();
  for (const [id, m] of map) if (m.isDeleted) out.add(id);
  return out;
}

/** 除外内訳の日本語ラベル（画面と配信履歴で同じ言葉を使う） */
export const BREAKDOWN_LABEL: Record<keyof ExcludedBreakdown, string> = {
  phoneOnly: "メールアドレスなし（電話のみ）",
  suppressed: "配信停止リストに登録",
  dup: "リスト間の重複",
  invalid: "形式が不正",
  withdrawn: "退会した会員",
};
