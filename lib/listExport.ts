// ============================================================
// リストのCSVエクスポート（Phase 5 ／ 確定事項 A4=a）
//
//   ・全項目を書き出す（A4=a）。
//   ・権限 contact_list_export（既定OFF）が無ければ実行できない。
//   ・実行を必ず contact_list_audit に記録する（誰が・いつ・何件持ち出したか）。
//
//   ⚠️ これは個人情報の持ち出しそのもの。以下は意図的な設計。
//      ① 記録に失敗したらエクスポートも中止する（「記録の無い持ち出し」を作らない）
//      ② ダウンロードするファイル名に**リスト名と日時**を必ず入れる
//      ③ 画面に出ている分だけでなく**全件**を読む（見えている50件だけ、を防ぐ）
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { ContactList, ListEntry, ListAudit, ListAuditAction } from "./models";
import { toListEntry, entryState, ENTRY_STATE_LABEL, applyEntryFilter, isFiltered } from "./contactLists";
import type { EntryFilter } from "./contactLists";
import { fetchWithdrawnMemberIds } from "./listRecipients";
import { fmtJst } from "./dateFmt";

/** 1回のページング件数。件数キャッシュではなく実体を読むのでやや大きめ。 */
const EXPORT_PAGE = 1000;

/**
 * 一度に書き出せる上限。
 * ⚠️ ブラウザのメモリに全行を載せるため上限を設ける。
 *    超える場合は絞り込んで分けて書き出してもらう（黙って切り捨てない）。
 */
export const EXPORT_MAX_ROWS = 100_000;

// ── CSV 組み立て（純関数：テストしやすいように DB に触らない）──
const csvCell = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** 書き出す列。順序＝この配列の順序。 */
export const EXPORT_COLUMNS = [
  "ID", "メールアドレス", "電話番号", "氏名", "年代", "都道府県",
  "備考1", "備考2", "状態", "会員ID", "紐づけ根拠",
  "同意日時", "同意取得元", "登録元", "登録日時", "更新日時",
] as const;

const MATCHED_BY_LABEL: Record<string, string> = {
  member_id: "会員IDで一致", email: "メールで名寄せ", "": "",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "手入力", csv: "CSV取込", md: "Markdown取込", api: "API",
};

/**
 * 電話番号のセル。
 *
 * ⚠️ Excel で開くと `08012345678` は数値になって**先頭の 0 が消える**。
 *    `="..."` の式形式にすると文字列として扱われ、桁落ちしない。
 * ⚠️ この形式は**CSVの引用符で囲んではいけない**（囲むと式として解釈されない）。
 *    そのため引用符・カンマ・改行はここで落とす（電話番号には現れない文字）。
 */
function phoneCell(phone: string): string {
  const safe = phone.replace(/["\r\n,]/g, "");
  return safe ? `="${safe}"` : "";
}

/**
 * レコードをCSV（UTF-8 BOM／CRLF）へ整形する。
 *
 * ⚠️ メールアドレスは Excel が勝手にリンク化するだけで値は壊れないので素のまま。
 */
export function entriesToCsv(
  entries: readonly ListEntry[],
  suppressed: ReadonlySet<string>,
  withdrawn: ReadonlySet<number>,
): string {
  const head = EXPORT_COLUMNS.map(csvCell).join(",");
  const body = entries.map((e) => {
    const st = entryState(e, suppressed, withdrawn);
    // ⚠️ 電話番号のセルだけは **エスケープ済み**として組み立てる
    //    （csvCell に通すと式形式が引用符で囲まれて機能しなくなる）。
    const escaped: string[] = [
      csvCell(String(e.id)),
      csvCell(e.email),
      phoneCell(e.phone),
      csvCell(e.name),
      csvCell(e.ageGroup),
      csvCell(e.prefecture),
      csvCell(e.note1),
      csvCell(e.note2),
      csvCell(ENTRY_STATE_LABEL[st] ?? ""),
      csvCell(e.memberId != null ? String(e.memberId) : ""),
      csvCell(MATCHED_BY_LABEL[e.matchedBy] ?? ""),
      csvCell(e.consentAt ? fmtJst(e.consentAt) : ""),
      csvCell(e.consentSrc),
      csvCell(SOURCE_LABEL[e.sourceKind] ?? e.sourceKind),
      csvCell(e.createdAt ? fmtJst(e.createdAt) : ""),
      csvCell(e.updatedAt ? fmtJst(e.updatedAt) : ""),
    ];
    return escaped.join(",");
  });
  // ⚠️ Excel が UTF-8 と判別できるよう BOM を付ける（付けないと日本語が化ける）
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/**
 * `2026夏_展示会名刺_20260817-1432.csv` のようなファイル名を作る。
 * ⚠️ 時刻は**JST 固定**。端末のタイムゾーン設定でファイル名が変わると、
 *    監査ログ（JST 表示）と突き合わせられなくなる。
 */
export function exportFileName(listName: string, now: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const j = new Date(now.getTime() + 9 * 3_600_000);
  const stamp =
    `${j.getUTCFullYear()}${p2(j.getUTCMonth() + 1)}${p2(j.getUTCDate())}` +
    `-${p2(j.getUTCHours())}${p2(j.getUTCMinutes())}`;
  // ファイル名に使えない文字と空白を潰す（OS 差で落ちないように保守的に）
  const safe = (listName || "list").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
  return `${safe}_${stamp}.csv`;
}

// ── 読み取り ────────────────────────────────────────────────
/**
 * エクスポート対象の全件を読む。
 * ⚠️ 画面のページング（50件）とは無関係に、絞り込み条件に合う**全件**を読む。
 * @returns 上限を超えた場合は truncated=true（呼び出し側で必ず知らせること）
 */
export async function fetchAllEntriesForExport(
  listId: number,
  filter: EntryFilter,
  signal?: { aborted: boolean },
): Promise<{ rows: ListEntry[]; truncated: boolean }> {
  const rows: ListEntry[] = [];
  let cursor: number | null = null;
  for (;;) {
    if (signal?.aborted) break;
    let q = supabase
      .from("contact_list_entries")
      .select("*")
      .eq("list_id", listId)
      .order("id", { ascending: false })
      .limit(EXPORT_PAGE);
    if (cursor != null) q = q.lt("id", cursor);
    // ⚠️ 画面の一覧とまったく同じ絞り込み関数を通す（分岐させない）
    q = applyEntryFilter(q, filter);

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    for (const r of data) rows.push(toListEntry(r));
    // ⚠️ 上限は「読み終わってから」ではなく毎ページ判定する
    //    （最終ページが端数でも打ち切りを取りこぼさない）
    if (rows.length >= EXPORT_MAX_ROWS) return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true };
    cursor = data[data.length - 1].id;
    if (data.length < EXPORT_PAGE) break;
  }
  return { rows, truncated: false };
}

// ── 監査ログ ────────────────────────────────────────────────
function toListAudit(r: Record<string, unknown>): ListAudit {
  const a = String(r.action ?? "");
  return {
    id: Number(r.id ?? 0),
    listId: r.list_id == null ? null : Number(r.list_id),
    action: (a === "export" || a === "merge" || a === "merge_source" ? a : "export") as ListAuditAction,
    actor: typeof r.actor === "string" ? r.actor : "",
    actorLabel: String(r.actor_label ?? ""),
    rowCount: Number(r.row_count ?? 0),
    detail: (r.detail && typeof r.detail === "object" && !Array.isArray(r.detail)
      ? (r.detail as Record<string, unknown>) : {}),
    createdAt: String(r.created_at ?? ""),
  };
}

/**
 * 操作を監査ログに記録する。
 * ⚠️ 戻り値 false は「記録できなかった」。持ち出し系の操作は
 *    ここが false のときは**実行を止める**こと（呼び出し側の責務）。
 */
export async function writeListAudit(input: {
  listId: number | null;
  action: ListAuditAction;
  rowCount: number;
  detail: Record<string, unknown>;
}): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const { error } = await supabase
    .from("contact_list_audit")
    .insert({
      list_id: input.listId,
      action: input.action,
      actor: user?.id ?? null,
      actor_label: user?.email ?? "",
      row_count: input.rowCount,
      detail: input.detail as Tables<"contact_list_audit">["detail"],
    });
  return !error;
}

/** そのリストの操作履歴（新しい順）。list_id が null になった過去分は出ない。 */
export async function fetchListAudits(listId: number, limit = 50): Promise<ListAudit[]> {
  const { data, error } = await supabase
    .from("contact_list_audit")
    .select("*")
    .eq("list_id", listId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(toListAudit);
}

export const AUDIT_ACTION_LABEL: Record<ListAuditAction, string> = {
  export: "CSVエクスポート",
  merge: "マージ（統合先）",
  merge_source: "マージ（統合元）",
};

// ── ダウンロード ────────────────────────────────────────────
/** 生成した CSV をブラウザからダウンロードさせる。 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ExportResult {
  ok: boolean;
  rowCount: number;
  truncated: boolean;
  error: string;
}

/**
 * エクスポートの実行本体（権限チェックは呼び出し側で済ませておくこと）。
 *
 * 手順：全件読み込み → **監査ログを先に書く** → CSV を作ってダウンロード。
 * ⚠️ 監査ログを先に書くのは、「記録の無い持ち出し」を絶対に作らないため。
 *    記録に失敗したらファイルは作らない。
 */
export async function exportListEntries(
  list: ContactList,
  filter: EntryFilter,
  suppressed: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<ExportResult> {
  const { rows, truncated } = await fetchAllEntriesForExport(list.id, filter);
  if (rows.length === 0) {
    return { ok: false, rowCount: 0, truncated: false, error: "書き出す対象がありません" };
  }

  // ⚠️ 退会判定は**書き出す全行**に対して引き直す。
  //    画面が持っている集合は「表示中の50件ぶん」しか無いため、
  //    それを流用すると退会者が「配信可」と書かれたCSVができてしまう。
  const withdrawn = await fetchWithdrawnMemberIds(
    Array.from(new Set(rows.map((r) => r.memberId).filter((v): v is number => v != null))),
  );

  const filtered = isFiltered(filter);

  const logged = await writeListAudit({
    listId: list.id,
    action: "export",
    rowCount: rows.length,
    detail: {
      listName: list.name,
      scope: filtered ? "filtered" : "all",
      filter: filtered ? filter : null,
      truncated,
      columns: EXPORT_COLUMNS.length,
    },
  });
  if (!logged) {
    return {
      ok: false, rowCount: 0, truncated,
      error: "操作履歴を記録できなかったため中止しました（権限をご確認ください）",
    };
  }

  downloadCsv(exportFileName(list.name, now), entriesToCsv(rows, suppressed, withdrawn));
  return { ok: true, rowCount: rows.length, truncated, error: "" };
}
