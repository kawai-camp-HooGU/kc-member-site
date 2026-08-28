// ============================================================
// リストのマージ（Phase 5）
//   複数のリストを1つに統合する。
//
//   ⚠️ 方針：**コピー＋統合元をアーカイブ**（統合元のレコードは消さない）。
//      ・レコードを物理削除すると、過去の配信履歴（contact_list_deliveries）や
//        取込履歴が指す実体が消えて追跡できなくなる。
//      ・統合元はアーカイブ（配信先に選べない状態）にするだけなので、
//        取り違えたときに解除するだけで元に戻せる。
//   ⚠️ 重複は統合先の部分UNIQUE索引が弾く。insertEntriesTolerant() 経由で
//      「入る分だけ入れる」（1件の重複で全体が落ちない）。
// ============================================================
import { supabase } from "./supabase";
import type { ContactList, ListEntry } from "./models";
import {
  toListEntry, insertEntriesTolerant, recountContactList,
  setContactListArchived, INSERT_CHUNK,
} from "./contactLists";
import type { EntryRow } from "./contactLists";
import { writeListAudit } from "./listExport";

/** 統合元を読むときの1ページ件数 */
const MERGE_PAGE = 500;

export interface MergePlan {
  /** 統合先のリスト */
  dest: ContactList;
  /** 統合元のリスト（destを含めてはいけない） */
  sources: ContactList[];
  /** 統合後に統合元をアーカイブするか（既定オン） */
  archiveSources: boolean;
}

export interface MergeProgress {
  /** 処理済みの統合元レコード数 */
  done: number;
  /** 統合元レコードの総数（件数キャッシュの合計＝目安） */
  total: number;
  /** 現在処理中の統合元リスト名 */
  current: string;
}

export interface MergeResult {
  ok: boolean;
  /** 統合先に新しく入った件数 */
  inserted: number;
  /** 重複していて入らなかった件数 */
  skipped: number;
  /** 読み込んだ統合元レコードの総数 */
  read: number;
  /** アーカイブした統合元リスト数 */
  archived: number;
  error: string;
}

/**
 * マージできる組み合わせか検証する。実行前に必ず通すこと。
 * 戻り値は日本語の理由。空文字＝問題なし。
 */
export function validateMerge(plan: MergePlan): string {
  if (plan.sources.length === 0) return "統合元のリストを選んでください";
  if (plan.sources.some((s) => s.id === plan.dest.id)) return "統合先と統合元に同じリストは選べません";
  if (plan.dest.isArchived) return "アーカイブ済みのリストは統合先にできません";
  if (plan.dest.isDeleted) return "削除されたリストは統合先にできません";
  const total = plan.sources.reduce((s, l) => s + l.entryCount, 0);
  if (total === 0) return "統合元にレコードがありません";
  return "";
}

/** 統合元レコードの合計（進捗表示の分母。件数キャッシュなので目安） */
export function mergeSourceTotal(sources: readonly ContactList[]): number {
  return sources.reduce((s, l) => s + l.entryCount, 0);
}

/** ListEntry を統合先の挿入行に変換する（同意の記録も必ず引き継ぐ） */
function toRow(destListId: number, e: ListEntry): EntryRow {
  return {
    list_id: destListId,
    member_id: e.memberId,
    matched_by: e.matchedBy || null,
    email: e.email || null,
    email_norm: e.emailNorm || null,
    phone: e.phone || null,
    phone_e164: e.phoneE164 || null,
    name: e.name,
    age_group: e.ageGroup || null,
    prefecture: e.prefecture || null,
    note1: e.note1,
    note2: e.note2,
    source_kind: e.sourceKind,
    consent_at: e.consentAt || null,
    consent_src: e.consentSrc || null,
    // REQ-049。統合先にも必ず引き継ぐ（落とすとラベル・LINE情報だけ消える）
    label: e.label,
    line_display_name: e.lineDisplayName,
    line_user_id: e.lineUserId || null,
  };
}

/**
 * マージの実行。
 *
 * ⚠️ ブラウザ側で分割実行する（Vercel の関数タイムアウトと 4.5MB の
 *    リクエスト上限を踏まえた Phase 2 と同じ方針）。
 * ⚠️ 途中で中断されても、そこまでに入った分は統合先に残る（巻き戻さない）。
 *    統合元は消していないので、もう一度実行すれば残りが入る（重複は弾かれる）。
 */
export async function runMerge(
  plan: MergePlan,
  onProgress?: (p: MergeProgress) => void,
  signal?: { aborted: boolean },
): Promise<MergeResult> {
  const bad = validateMerge(plan);
  if (bad) return { ok: false, inserted: 0, skipped: 0, read: 0, archived: 0, error: bad };

  const total = mergeSourceTotal(plan.sources);
  let read = 0;
  let inserted = 0;
  let aborted = false;

  for (const src of plan.sources) {
    let cursor: number | null = null;
    for (;;) {
      if (signal?.aborted) { aborted = true; break; }

      let q = supabase
        .from("contact_list_entries")
        .select("*")
        .eq("list_id", src.id)
        .order("id", { ascending: false })
        .limit(MERGE_PAGE);
      if (cursor != null) q = q.lt("id", cursor);

      const { data, error } = await q;
      if (error) {
        return {
          ok: false, inserted, skipped: read - inserted, read, archived: 0,
          error: `「${src.name}」の読み込みに失敗しました`,
        };
      }
      if (!data || data.length === 0) break;

      const rows = data.map((r) => toRow(plan.dest.id, toListEntry(r)));
      inserted += await insertEntriesTolerant(rows);
      read += rows.length;
      onProgress?.({ done: read, total, current: src.name });

      cursor = data[data.length - 1].id;
      if (data.length < MERGE_PAGE) break;
    }
    if (aborted) break;
  }

  await recountContactList(plan.dest.id);

  // 統合元のアーカイブは**全部入れ終わってから**行う
  //   （途中で落ちたときに「アーカイブされたのに中身は移っていない」を作らない）
  let archived = 0;
  if (!aborted && plan.archiveSources) {
    for (const src of plan.sources) {
      if (src.isArchived) continue;
      if (await setContactListArchived(src.id, true)) archived += 1;
    }
  }

  // 監査ログ：統合先に1件、統合元それぞれに1件ずつ残す。
  //   ⚠️ 記録の失敗でマージ結果を巻き戻すことはしない（既に入った行は消せない）。
  //      エクスポートと違い、ここは「持ち出し」ではなく内部の移動のため。
  await writeListAudit({
    listId: plan.dest.id,
    action: "merge",
    rowCount: inserted,
    detail: {
      destName: plan.dest.name,
      sourceIds: plan.sources.map((s) => s.id),
      sourceNames: plan.sources.map((s) => s.name),
      read, skipped: read - inserted, archived, aborted,
    },
  });
  for (const src of plan.sources) {
    await writeListAudit({
      listId: src.id,
      action: "merge_source",
      rowCount: src.entryCount,
      detail: { destId: plan.dest.id, destName: plan.dest.name, archived: plan.archiveSources && !aborted },
    });
  }

  return {
    ok: !aborted,
    inserted,
    skipped: read - inserted,
    read,
    archived,
    error: aborted ? "中断しました（ここまでの分は統合先に入っています）" : "",
  };
}

/** 進捗の分割単位（画面の説明文で使う） */
export const MERGE_CHUNK = INSERT_CHUNK;
