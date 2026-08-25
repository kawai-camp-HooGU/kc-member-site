// ============================================================
// 入出金の一括取込：DB 側（既存データの取得・実行・取消）
//
//   解析と検証は lib/cashImport.ts（純関数）。ここは Supabase を触る層だけ。
//
//   ⚠️ 入出金と消込は別テーブルで、クライアントからはトランザクションを張れない。
//      1件ずつ「入出金を作る → その消込を入れる」の順で進める。
//      途中で失敗しても、**そこまでに作った入出金は消込付きで正しく揃っている**。
//      中途半端な入出金（消込だけ欠けた行）が残らないのはこの順序のおかげ。
// ============================================================
import { supabase } from "./supabase";
import { willImportCash, type CashImportGroup } from "./cashImport";
import { fixedPeriods } from "./profitShareRun";

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "42P01"
    || err.code === "PGRST205"
    || msg.includes("does not exist")
    || msg.includes("could not find the table");
}

let cashImportTables: boolean | null = null;
export const cashImportAvailable = (): boolean | null => cashImportTables;

// ── 重複判定に使う既存データ ──────────────────────────────────
export interface ExistingCash {
  /** 入金ID → cash_entries.id */
  payouts: Map<string, number>;
  /** 自然キーの素材（日付・区分・経路・金額・摘要）→ id。ハッシュ化は呼び出し側で行う */
  rows: { id: number; direction: string; entryDate: string; siteId: number | null; amount: number; description: string }[];
}

export async function loadExistingCash(): Promise<ExistingCash> {
  const payouts = new Map<string, number>();
  const { data, error } = await supabase.from("cash_entries" as never)
    .select("id, direction, entry_date, site_id, amount, description, external_payout_id")
    .eq("is_deleted", false);
  if (error) {
    if (isMissingTable(error)) { cashImportTables = false; return { payouts, rows: [] }; }
    throw error;
  }
  cashImportTables = true;
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const id = Number(r.id);
    const pid = String(r.external_payout_id ?? "").trim();
    if (pid) payouts.set(pid, id);
    return {
      id,
      direction: r.direction === "out" ? "out" : "in",
      entryDate: String(r.entry_date ?? "").slice(0, 10),
      siteId: r.site_id == null ? null : Number(r.site_id),
      amount: Number(r.amount ?? 0),
      description: String(r.description ?? ""),
    };
  });
  return { payouts, rows };
}

// ── 実行 ──────────────────────────────────────────────────────
export interface CashRunInput {
  fileName: string;
  fileHash: string;
  mapping: unknown;
  groups: CashImportGroup[];
}

export interface CashRunResult {
  jobId: number | null;
  ok: number;
  skipped: number;
  errored: number;
  allocations: number;
  failures: { no: number; reason: string }[];
  error?: string;
}

const CHUNK = 200;

export async function runCashImport(
  i: CashRunInput,
  onProgress?: (done: number, total: number) => void,
): Promise<CashRunResult> {
  const targets = i.groups.filter(willImportCash);
  const errored = i.groups.filter((g) => g.verdict === "error").length;
  const skipped = i.groups.length - targets.length - errored;
  const failures: { no: number; reason: string }[] = [];

  const job = await supabase.from("import_jobs" as never).insert({
    target: "cash",
    file_name: i.fileName,
    file_hash: i.fileHash,
    mapping: i.mapping ?? {},
    total_count: i.groups.length,
    ok_count: 0,
    skip_count: skipped,
    ng_count: errored,
    status: "running",
  } as never).select("id").single();

  if (job.error) {
    if (isMissingTable(job.error)) cashImportTables = false;
    return { jobId: null, ok: 0, skipped, errored, allocations: 0, failures, error: job.error.message };
  }
  const jobId = (job.data as { id: number }).id;

  let ok = 0, allocs = 0;

  for (let n = 0; n < targets.length; n += 1) {
    const g = targets[n];
    const e = g.entry;
    // 差額は明細に按分せず、この入出金の調整1行として持つ（P3b と同じ扱い）
    const adjustments = g.adjustment ? [g.adjustment] : [];

    const ins = await supabase.from("cash_entries" as never).insert({
      direction: e.direction,
      entry_date: e.entryDate || null,
      site_id: e.siteId,
      account_name: e.accountName,
      amount: Math.max(0, Math.round(e.amount) || 0),
      description: e.description,
      adjustments,
      external_payout_id: e.externalPayoutId,
      import_job_id: jobId,
    } as never).select("id").single();

    if (ins.error) {
      failures.push({ no: g.no, reason: ins.error.message });
      onProgress?.(n + 1, targets.length);
      continue;
    }
    const entryId = (ins.data as { id: number }).id;

    const rows = g.allocations
      .filter((a) => a.sourceId != null && a.amount > 0)
      .map((a) => ({
        cash_entry_id: entryId,
        source_type: a.sourceType,
        source_id: a.sourceId,
        amount: Math.round(a.amount),
      }));
    if (rows.length) {
      const al = await supabase.from("cash_allocations" as never).insert(rows as never);
      if (al.error) {
        // 入出金だけ残ると差額が実着金額まるごとになる。作った入出金を消して整合を保つ
        await supabase.from("cash_entries" as never).delete().eq("id", entryId);
        failures.push({ no: g.no, reason: `消込の登録に失敗しました：${al.error.message}` });
        onProgress?.(n + 1, targets.length);
        continue;
      }
      allocs += rows.length;
    }
    ok += 1;
    onProgress?.(n + 1, targets.length);
  }

  await saveCashImportRows(jobId, i.groups);

  await supabase.from("import_jobs" as never).update({
    ok_count: ok,
    ng_count: errored + failures.length,
    status: failures.length ? "partial" : "done",
  } as never).eq("id", jobId);

  return {
    jobId, ok, skipped, errored: errored + failures.length, allocations: allocs, failures,
    error: failures.length ? `${failures.length}件が登録できませんでした` : undefined,
  };
}

/** 判定の記録。落ちても取込自体は成功扱いにする（記録のためだけの表なので） */
async function saveCashImportRows(jobId: number, groups: CashImportGroup[]): Promise<void> {
  const body = groups.map((g) => ({
    job_id: jobId,
    row_no: g.rowNos[0] ?? g.no,
    raw: {
      rowNos: g.rowNos,
      payoutId: g.entry.externalPayoutId,
      amount: g.entry.amount,
      allocations: g.allocations.length,
    },
    verdict: willImportCash(g) ? "ok" : g.verdict === "error" ? "error" : "skip_dup",
    errors: g.reasons,
  }));
  for (let s = 0; s < body.length; s += CHUNK) {
    const { error } = await supabase.from("import_rows" as never).insert(body.slice(s, s + CHUNK) as never);
    if (error) { console.error("取込の記録に失敗:", error.message); return; }
  }
}

// ── 取消 ──────────────────────────────────────────────────────
export interface CashUndoResult {
  undone: number;
  /** 分配確定済みの月にあり取り消せなかった件数 */
  lockedByShare: number;
  error?: string;
}

/**
 * 入出金の取込をジョブ単位で取り消す。
 *
 * ⚠️ 消込を先に消してから入出金を論理削除する。逆にすると、
 *    論理削除された入出金にぶら下がった消込が残り、明細が「消込済み」のままになる。
 *
 * 利益分配が確定している月の入出金は取り消さない（P4 と同じ扱い）。
 */
export async function undoCashImport(jobId: number): Promise<CashUndoResult> {
  const list = await supabase.from("cash_entries" as never)
    .select("id, entry_date").eq("import_job_id", jobId).eq("is_deleted", false);
  if (list.error) return { undone: 0, lockedByShare: 0, error: list.error.message };
  const rows = (list.data ?? []) as { id: number; entry_date?: string | null }[];
  if (!rows.length) return { undone: 0, lockedByShare: 0 };

  const fixed = await fixedPeriods();
  const free = rows.filter((r) => !fixed.has((r.entry_date ?? "").slice(0, 7)));
  const lockedByShare = rows.length - free.length;
  if (!free.length) return { undone: 0, lockedByShare };

  const ids = free.map((r) => r.id);
  const del = await supabase.from("cash_allocations" as never).delete().in("cash_entry_id", ids);
  if (del.error) return { undone: 0, lockedByShare, error: `消込の削除に失敗しました：${del.error.message}` };

  const upd = await supabase.from("cash_entries" as never)
    .update({ is_deleted: true } as never).in("id", ids);
  if (upd.error) return { undone: 0, lockedByShare, error: upd.error.message };

  await supabase.from("import_jobs" as never).update({
    status: lockedByShare ? "partial_reverted" : "reverted",
    reverted_at: new Date().toISOString(),
  } as never).eq("id", jobId);

  return { undone: ids.length, lockedByShare };
}
