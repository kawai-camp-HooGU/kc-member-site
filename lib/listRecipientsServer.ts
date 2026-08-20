// ============================================================
// リスト配信：サーバー側の宛先解決（service role 使用）
//
//   ⚠️ 除外の規則は **画面側 lib/listRecipients.ts と必ず一致させること**。
//      画面が「1,706件送ります」と予告した数と実績が食い違うと、
//      それ自体が事故（送りすぎ／送り漏れ）になる。
//      規則を変えるときは必ず両方を同時に直す。
//
//   除外
//     ・メールアドレスなし（電話のみ）… メール配信できない
//     ・配信停止リストに登録         … email_suppressions と突合
//     ・リスト間の重複               … 同じ人に2通送らない（既定オン）
//     ・形式が不正                   … 正規化できなかったもの
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { normalizeEmail } from "./emailNormalize";
import { loadSuppressedSets, isSuppressed } from "./suppressionServer";
import { resolveContact } from "./listMemberState";
import type { MemberContact } from "./listMemberState";

// 停止照合の正本は lib/suppressionServer.ts。テストや送信エンジンから
// 同じ入口で使えるよう、ここでも再輸出しておく。
export { loadSuppressedSets, isSuppressed };

export interface ServerListRecipient {
  /** 実際に送るアドレス（生の値） */
  email: string;
  /** 重複判定・停止照合に使う正規化値 */
  emailNorm: string;
  name: string;
  memberId: number | null;
  /** 最初にこのアドレスを出したリスト（配信履歴の按分に使う） */
  listId: number;
  /** 会員の最新アドレスに差し替えたか（確定事項 A2） */
  usedMemberEmail: boolean;
}

export interface ServerBreakdown {
  phoneOnly: number;
  suppressed: number;
  dup: number;
  invalid: number;
  /** 退会（論理削除）した会員のため対象外（確定事項 A3） */
  withdrawn: number;
}

/** リスト1件ぶんの送信時点スナップショット（contact_list_deliveries に落とす） */
export interface PerListSnapshot {
  listId: number;
  listName: string;
  /** 送信時点のリスト件数（レコード総数） */
  targetCount: number;
  sentCount: number;
  excludedCount: number;
  breakdown: ServerBreakdown;
}

export interface ServerListAudience {
  recipients: ServerListRecipient[];
  targetCount: number;
  sendCount: number;
  excludedCount: number;
  breakdown: ServerBreakdown;
  perList: PerListSnapshot[];
}

/**
 * 選択されたリストからメール配信の宛先を解決する。
 * リストごとの内訳（配信履歴に残すスナップショット）も同時に作る。
 */
export async function resolveListAudienceServer(
  listIds: number[],
  dedupe: boolean,
): Promise<ServerListAudience> {
  const empty: ServerListAudience = {
    recipients: [], targetCount: 0, sendCount: 0, excludedCount: 0,
    breakdown: { phoneOnly: 0, suppressed: 0, dup: 0, invalid: 0, withdrawn: 0 },
    perList: [],
  };
  if (listIds.length === 0) return empty;

  const { data: lists } = await supabaseAdmin
    .from("contact_lists")
    .select("id, name, entry_count, phone_only_count")
    .in("id", listIds);
  if (!lists || lists.length === 0) return empty;

  const sup = await loadSuppressedSets();

  const recipients: ServerListRecipient[] = [];
  const seen = new Set<string>();
  const perList: PerListSnapshot[] = [];

  // ⚠️ 選択順で処理する（重複は「先に出たリスト」に按分される）。
  //    画面側 listRecipients.ts と同じ順序・同じ規則。
  for (const listId of listIds) {
    const meta = lists.find((l) => l.id === listId);
    if (!meta) continue;

    // ① レコードを読む
    interface RawEntry { email: string; emailNorm: string; name: string; memberId: number | null }
    const raws: RawEntry[] = [];
    let cursor: number | null = null;
    for (;;) {
      let q = supabaseAdmin
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
          name: r.name ?? "", memberId: r.member_id ?? null,
        });
      }
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }

    // ② 紐づく会員を解決（A2：最新アドレス／A3：退会は送らない）
    const memberMap = await fetchMemberContactsServer(
      Array.from(new Set(raws.map((r) => r.memberId).filter((v): v is number => v != null))),
    );

    let sent = 0;
    let suppressed = 0;
    let dup = 0;
    let invalid = 0;
    let withdrawn = 0;

    for (const r of raws) {
      if (!r.emailNorm || !r.email || !normalizeEmail(r.email)) { invalid += 1; continue; }
      const c = resolveContact(r.email, r.emailNorm, r.memberId != null ? memberMap.get(r.memberId) : null);
      if (c.withdrawn) { withdrawn += 1; continue; }               // A3
      if (isSuppressed(sup, c.email, c.emailNorm)) { suppressed += 1; continue; }
      if (dedupe && seen.has(c.emailNorm)) { dup += 1; continue; }
      seen.add(c.emailNorm);
      recipients.push({
        email: c.email, emailNorm: c.emailNorm, name: r.name,
        memberId: r.memberId, listId, usedMemberEmail: c.usedMemberEmail,
      });
      sent += 1;
    }

    const phoneOnly = meta.phone_only_count ?? 0;
    const targetCount = meta.entry_count ?? 0;
    const breakdown: ServerBreakdown = { phoneOnly, suppressed, dup, invalid, withdrawn };
    perList.push({
      listId,
      listName: meta.name ?? "",
      targetCount,
      sentCount: sent,
      excludedCount: phoneOnly + suppressed + dup + invalid + withdrawn,
      breakdown,
    });
  }

  const breakdown = perList.reduce<ServerBreakdown>((acc, p) => ({
    phoneOnly: acc.phoneOnly + p.breakdown.phoneOnly,
    suppressed: acc.suppressed + p.breakdown.suppressed,
    dup: acc.dup + p.breakdown.dup,
    invalid: acc.invalid + p.breakdown.invalid,
    withdrawn: acc.withdrawn + p.breakdown.withdrawn,
  }), { phoneOnly: 0, suppressed: 0, dup: 0, invalid: 0, withdrawn: 0 });

  const targetCount = perList.reduce((s, p) => s + p.targetCount, 0);
  return {
    recipients,
    targetCount,
    sendCount: recipients.length,
    excludedCount: breakdown.phoneOnly + breakdown.suppressed + breakdown.dup + breakdown.invalid + breakdown.withdrawn,
    breakdown,
    perList,
  };
}

/**
 * 紐づく会員をまとめて引く（A2/A3 の判定に使う）。
 * ⚠️ in() はURL長の制限があるため分割して引く。
 */
async function fetchMemberContactsServer(memberIds: number[]): Promise<Map<number, MemberContact>> {
  const map = new Map<number, MemberContact>();
  if (memberIds.length === 0) return map;
  for (let i = 0; i < memberIds.length; i += 200) {
    const { data } = await supabaseAdmin
      .from("members").select("id, email, is_deleted").in("id", memberIds.slice(i, i + 200));
    for (const m of data ?? []) {
      map.set(m.id, { id: m.id, email: m.email ?? "", isDeleted: m.is_deleted ?? false });
    }
  }
  return map;
}

/**
 * 配信履歴（送信時点のスナップショット）を記録する。
 *
 * ⚠️ リスト名・件数を**その時点の値で写す**のが要点。
 *    list_id 参照だけにすると、後からリストを編集・改名・アーカイブしたときに
 *    「あの配信は誰に送ったのか」が復元できなくなる。
 */
export async function recordListDeliveries(args: {
  perList: PerListSnapshot[];
  kind: "broadcast" | "scenario";
  broadcastId?: number | null;
  scenarioId?: number | null;
  titleSnapshot: string;
  channel: string;
  /** 実際に送信できた件数（送信失敗を差し引いた実績）。省略時は sentCount を使う */
  actualSentByList?: Map<number, number>;
}): Promise<void> {
  if (args.perList.length === 0) return;
  const rows = args.perList.map((p) => {
    const actual = args.actualSentByList?.get(p.listId);
    const sent = actual == null ? p.sentCount : actual;
    return {
      list_id: p.listId,
      kind: args.kind,
      broadcast_id: args.broadcastId ?? null,
      scenario_id: args.scenarioId ?? null,
      list_name_snapshot: p.listName,
      title_snapshot: args.titleSnapshot,
      channel: args.channel,
      target_count: p.targetCount,
      sent_count: sent,
      // 送信できなかった分も除外に含める（対象 = 送信 + 除外 を常に成立させる）
      excluded_count: Math.max(0, p.targetCount - sent),
      excluded_breakdown: p.breakdown as unknown as Record<string, number>,
    };
  });
  await supabaseAdmin.from("contact_list_deliveries").insert(rows);
}
