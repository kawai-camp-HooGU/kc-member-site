// ============================================================
// 売上・経費の一括取込：DB 側（既存データの取得・実行・取消）
//
//   解析と検証は lib/plImport.ts（純関数）。ここは Supabase を触る層だけ。
//
//   ＜ジョブ単位で取り消せるようにする＞
//   取り込んだ全レコードに import_job_id を持たせ、まとめて論理削除できる（設計書 §6-5）。
//   復旧手段が無い一括取込は怖くて使えない。
//
//   ⚠️ Supabase クライアントからは複数テーブルをまたぐトランザクションを張れない。
//      「ジョブを作る → 明細を分割して入れる → ジョブの件数を更新する」の順で行い、
//      途中で失敗したら**そこまでの分をジョブごと取り消せる**状態で止める。
//      黙って半分だけ入った状態にはしない。
// ============================================================
import { supabase } from "./supabase";
import { normalizeEmail } from "./emailNormalize";
import type { SaveResult } from "./payments";
import {
  extKey, willImport,
  type ImportTarget, type PlColumnMap, type PlImportRow,
} from "./plImport";
import { fixedPeriods } from "./profitShareRun";

/** 1回の insert に載せる行数。大きすぎるとタイムアウト、小さすぎると往復が増える */
export const CHUNK = 200;

// ── テーブル未作成の検知（マイグレーション未適用でも壊さない）──
let importTables: boolean | null = null;
export const importAvailable = (): boolean | null => importTables;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "42P01"
    || err.code === "PGRST205"
    || msg.includes("does not exist")
    || msg.includes("could not find the table");
}
function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "PGRST204" || err.code === "42703"
    || msg.includes("could not find the")
    || (msg.includes("column") && msg.includes("does not exist"));
}

// ── 重複判定に使う既存データ ──────────────────────────────────
export interface ExistingIndex {
  /** 外部取引IDのキー → レコードID */
  ext: Map<string, number>;
  /** dedup_hash → レコードID */
  key: Map<string, number>;
  /** dedup_hash 列がまだ無い（マイグレーション未適用）*/
  keyUnavailable: boolean;
}

/**
 * 重複判定用に既存レコードの索引を作る。
 *
 * ⚠️ dedup_hash 列が無い環境では**自然キーによる重複判定ができない**。
 *    黙って「重複なし」にすると二重登録が通ってしまうので、
 *    keyUnavailable を返して画面に明示させる。
 */
export async function loadExisting(target: ImportTarget): Promise<ExistingIndex> {
  const table = target === "sales" ? "payments" : "expenses";
  const ext = new Map<string, number>();
  const key = new Map<string, number>();

  const full = await supabase.from(table as never)
    .select("id, external_source, external_txn_id, dedup_hash")
    .eq("is_deleted", false);

  let rows: { id: number; external_source?: string | null; external_txn_id?: string | null; dedup_hash?: string | null }[] = [];
  let keyUnavailable = false;

  if (full.error) {
    if (isMissingTable(full.error)) { importTables = false; return { ext, key, keyUnavailable: true }; }
    if (!isMissingColumn(full.error)) throw full.error;
    // 追加列が無い環境。外部取引IDだけで判定する
    keyUnavailable = true;
    const fb = await supabase.from(table as never).select("id").eq("is_deleted", false);
    if (fb.error) throw fb.error;
    rows = (fb.data ?? []) as never;
  } else {
    rows = (full.data ?? []) as never;
  }

  for (const r of rows) {
    const txn = (r.external_txn_id ?? "").trim();
    if (txn) ext.set(extKey(r.external_source ?? "", txn), r.id);
    const h = (r.dedup_hash ?? "").trim();
    if (h) key.set(h, r.id);
  }
  return { ext, key, keyUnavailable };
}

/** 会員照合用：正規化メール → 会員ID */
export async function loadMemberIndex(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const { data, error } = await supabase.from("members").select("id, email");
  if (error) return m;   // 会員照合できなくても取込自体は続ける（未照合で入る）
  for (const r of (data ?? []) as { id: number; email: string | null }[]) {
    const n = normalizeEmail(r.email);
    if (n && !m.has(n)) m.set(n, r.id);
  }
  return m;
}

// ── 同一ファイルの再取込チェック ──────────────────────────────
export interface PastJob {
  id: number;
  fileName: string;
  createdAt: string;
  okCount: number;
}

/** 同じ内容のファイルを過去に取り込んでいないか（設計書 §6-2 の判定④） */
export async function findJobsByFileHash(hash: string): Promise<PastJob[]> {
  if (!hash) return [];
  const { data, error } = await supabase.from("import_jobs" as never)
    .select("id, file_name, created_at, ok_count, status")
    .eq("file_hash", hash).order("id", { ascending: false }).limit(5);
  if (error) { if (isMissingTable(error)) importTables = false; return []; }
  return ((data ?? []) as { id: number; file_name: string | null; created_at: string | null; ok_count: number | null; status: string | null }[])
    .filter((r) => r.status !== "reverted")
    .map((r) => ({ id: r.id, fileName: r.file_name ?? "", createdAt: r.created_at ?? "", okCount: r.ok_count ?? 0 }));
}

// ── 実行 ──────────────────────────────────────────────────────
export interface RunInput {
  target: ImportTarget;
  fileName: string;
  fileHash: string;
  map: PlColumnMap;
  rows: PlImportRow[];
}

export interface RunResult {
  jobId: number | null;
  ok: number;
  skipped: number;
  errored: number;
  /** 失敗して入らなかった行（理由つき）*/
  failures: { no: number; reason: string }[];
  error?: string;
}

/** 売上1行 → payments の行 */
function toPaymentRow(r: PlImportRow, jobId: number): Record<string, unknown> {
  const v = r.value;
  return {
    member_id: v.memberId,
    customer_name: v.customerName,
    customer_kana: v.customerKana,
    customer_email: v.email,
    customer_tel: v.customerTel,
    paid_at: v.paidAt || null,
    type_id: v.typeId,
    site_id: v.siteId,
    method_id: v.methodId,
    amount: v.amount,
    recognized_amount: v.recognizedAmount,
    currency: "JPY",
    note: v.note,
    status: v.memberId != null ? "matched" : "unmatched",
    matched_at: v.memberId != null ? new Date().toISOString() : null,
    accrual_date: v.accrualDate || null,
    expected_date: v.expectedDate || null,
    fee_amount: v.feeAmount,
    is_fee_manual: false,
    is_date_manual: false,
    external_source: v.externalSource,
    external_txn_id: v.externalTxnId,
    dedup_hash: r.dedupHash,
    import_job_id: jobId,
  };
}

/** 経費1行 → expenses の行 */
function toExpenseRow(r: PlImportRow, jobId: number): Record<string, unknown> {
  const v = r.value;
  return {
    paid_at: v.paidAt || null,
    accrual_date: v.accrualDate || null,
    expected_date: v.expectedDate || null,
    category_id: v.categoryId,
    site_id: v.siteId,
    method_id: v.methodId,
    vendor_name: v.vendorName,
    vendor_invoice_no: v.invoiceNo,
    amount: v.amount,
    fee_amount: v.feeAmount,
    recognized_amount: v.recognizedAmount,
    currency: "JPY",
    note: v.note,
    is_fee_manual: false,
    is_date_manual: false,
    external_source: v.externalSource,
    external_txn_id: v.externalTxnId,
    dedup_hash: r.dedupHash,
    import_job_id: jobId,
  };
}

/**
 * 取込を実行する。
 *
 * @param onProgress 進捗（済み件数, 総件数）。実行中は画面を閉じさせないため
 */
export async function runPlImport(
  i: RunInput,
  onProgress?: (done: number, total: number) => void,
): Promise<RunResult> {
  const targets = i.rows.filter(willImport);
  const errored = i.rows.filter((r) => r.verdict === "error").length;
  const skipped = i.rows.length - targets.length - errored;
  const failures: { no: number; reason: string }[] = [];

  // ① ジョブを作る（この時点では件数0。最後に確定させる）
  const job = await supabase.from("import_jobs" as never).insert({
    target: i.target,
    file_name: i.fileName,
    file_hash: i.fileHash,
    mapping: { map: i.map },
    total_count: i.rows.length,
    ok_count: 0,
    skip_count: skipped,
    ng_count: errored,
    status: "running",
  } as never).select("id").single();

  if (job.error) {
    if (isMissingTable(job.error)) importTables = false;
    return { jobId: null, ok: 0, skipped, errored, failures, error: job.error.message };
  }
  const jobId = (job.data as { id: number }).id;

  // ② 明細を分割して入れる
  const table = i.target === "sales" ? "payments" : "expenses";
  const build = i.target === "sales" ? toPaymentRow : toExpenseRow;
  let ok = 0;

  for (let s = 0; s < targets.length; s += CHUNK) {
    const chunk = targets.slice(s, s + CHUNK);
    const { error } = await supabase.from(table as never)
      .insert(chunk.map((r) => build(r, jobId)) as never);

    if (error) {
      // 塊ごと失敗したら1行ずつ入れ直し、どの行が悪いのかを特定する
      for (const r of chunk) {
        const one = await supabase.from(table as never).insert(build(r, jobId) as never);
        if (one.error) failures.push({ no: r.no, reason: one.error.message });
        else ok += 1;
      }
    } else {
      ok += chunk.length;
    }
    onProgress?.(Math.min(s + CHUNK, targets.length), targets.length);
  }

  // ③ 取り込んだ行の記録（重複・エラーの理由も残す。あとで理由を追える）
  await saveImportRows(jobId, i.rows);

  // ④ ジョブを確定
  await supabase.from("import_jobs" as never).update({
    ok_count: ok,
    ng_count: errored + failures.length,
    status: failures.length ? "partial" : "done",
  } as never).eq("id", jobId);

  return {
    jobId, ok, skipped, errored: errored + failures.length, failures,
    error: failures.length ? `${failures.length}件が登録できませんでした` : undefined,
  };
}

/** 判定の記録。落ちても取込自体は成功扱いにする（記録のためだけの表なので） */
async function saveImportRows(jobId: number, rows: PlImportRow[]): Promise<void> {
  const body = rows.map((r) => ({
    job_id: jobId,
    row_no: r.no,
    raw: { values: r.raw },
    verdict: willImport(r) ? "ok" : r.verdict === "error" ? "error" : "skip_dup",
    errors: r.reasons,
  }));
  for (let s = 0; s < body.length; s += CHUNK) {
    const { error } = await supabase.from("import_rows" as never).insert(body.slice(s, s + CHUNK) as never);
    if (error) { console.error("取込の記録に失敗:", error.message); return; }
  }
}

// ── 取消 ──────────────────────────────────────────────────────
export interface UndoResult {
  undone: number;
  /** 消込済みで取り消せなかった件数 */
  locked: number;
  /** 分配確定済みの月にあり取り消せなかった件数 */
  lockedByShare: number;
  error?: string;
}

/**
 * ジョブ単位で取り消す（論理削除）。
 *
 * 取り消せないものが2種類ある（設計書 §6-5）。
 *   ① **消込済みの行**… 取り消すと入出金の充当先が消え、
 *      「充当額 − 調整 ＝ 実着金額」の検算が崩れる。
 *   ② **利益分配で確定済みの月の行**… 分配額を計算し直すことになり、
 *      すでに支払ったパートナーへの金額と合わなくなる。
 * どちらも残した件数を返して画面に出させる。
 */
export async function undoImportJob(jobId: number, target: ImportTarget): Promise<UndoResult> {
  const table = target === "sales" ? "payments" : "expenses";
  const sourceType = target === "sales" ? "payment" : "expense";

  const list = await supabase.from(table as never).select("id, accrual_date")
    .eq("import_job_id", jobId).eq("is_deleted", false);
  if (list.error) return { undone: 0, locked: 0, lockedByShare: 0, error: list.error.message };
  const rows = (list.data ?? []) as { id: number; accrual_date?: string | null }[];
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { undone: 0, locked: 0, lockedByShare: 0 };

  // 消込済みのIDを除く
  const alloc = await supabase.from("cash_allocations" as never)
    .select("source_id").eq("source_type", sourceType).in("source_id", ids);
  const settled = new Set<number>(
    alloc.error ? [] : ((alloc.data ?? []) as { source_id: number }[]).map((r) => r.source_id),
  );

  // 分配が確定している月の行を除く
  const fixed = await fixedPeriods();
  const inFixed = new Set<number>(
    fixed.size === 0 ? [] : rows
      .filter((r) => fixed.has((r.accrual_date ?? "").slice(0, 7)))
      .map((r) => r.id),
  );

  const free = ids.filter((id) => !settled.has(id) && !inFixed.has(id));
  const lockedByShare = ids.filter((id) => inFixed.has(id) && !settled.has(id)).length;
  if (!free.length) return { undone: 0, locked: settled.size, lockedByShare };

  const del = await supabase.from(table as never)
    .update({ is_deleted: true } as never).in("id", free);
  if (del.error) return { undone: 0, locked: settled.size, lockedByShare, error: del.error.message };

  const anyLocked = settled.size > 0 || lockedByShare > 0;
  await supabase.from("import_jobs" as never).update({
    status: anyLocked ? "partial_reverted" : "reverted",
    reverted_at: new Date().toISOString(),
  } as never).eq("id", jobId);

  return { undone: free.length, locked: settled.size, lockedByShare };
}

// ── 取込履歴 ──────────────────────────────────────────────────
/** ジョブの取込先。入出金（着金バッチ）は売上・経費と粒度が違うので別扱い */
export type JobTarget = ImportTarget | "cash";

export interface ImportJob {
  id: number;
  target: JobTarget;
  fileName: string;
  totalCount: number;
  okCount: number;
  skipCount: number;
  errorCount: number;
  status: string;
  createdAt: string;
}

export const JOB_STATUS_LABEL: Record<string, string> = {
  running: "実行中", done: "完了", partial: "一部失敗", failed: "失敗",
  reverted: "取消済み", partial_reverted: "一部取消",
};

export async function fetchImportJobs(limit = 30): Promise<ImportJob[]> {
  const { data, error } = await supabase.from("import_jobs" as never)
    .select("*").order("id", { ascending: false }).limit(limit);
  if (error) { if (isMissingTable(error)) importTables = false; return []; }
  importTables = true;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    target: r.target === "expense" ? "expense" : r.target === "cash" ? "cash" : "sales",
    fileName: String(r.file_name ?? ""),
    totalCount: Number(r.total_count ?? 0),
    okCount: Number(r.ok_count ?? 0),
    skipCount: Number(r.skip_count ?? 0),
    errorCount: Number(r.ng_count ?? 0),
    status: String(r.status ?? ""),
    createdAt: String(r.created_at ?? ""),
  }));
}

/** マスタに無かった名称をその場で追加する（プレビューからの導線）*/
export async function addMasterByName(
  kind: "type" | "site" | "method" | "category",
  name: string,
): Promise<SaveResult> {
  const table = kind === "category" ? "expense_categories"
    : kind === "type" ? "payment_product_types"
      : kind === "site" ? "payment_sites" : "payment_methods";
  const { data, error } = await supabase.from(table as never)
    .insert({ name, note: "", sort_order: 999, is_deleted: false } as never)
    .select("id").single();
  if (error) return { id: null, error: error.message };
  return { id: (data as { id: number }).id };
}
