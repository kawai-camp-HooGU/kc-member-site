// ============================================================
// リスト一括取り込み：ジョブの記録と分割実行
//
//   ⚠️ 実行はブラウザ側で行う（設計書 rev.2 からの変更点）。
//      設計時は API Route の非同期ジョブとしていたが、Vercel の制約
//      （リクエストボディ 4.5MB・関数タイムアウト）で 5万行は通らない。
//      RLS（is_ops()）が効いたままクライアントから直接投入し、
//      500件ずつに分割して進捗を出す方式に変えている。
//      ジョブ行は従来どおり DB に残すので、取込履歴タブと失敗CSVの
//      ダウンロードは設計どおり動く。
//
//   ⚠️ タブを閉じると中断する。中断してもそこまでの分は入り、
//      ジョブ行には status='canceled' と実績件数が残る（何が入ったか追える）。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { DupCheckRow, EntryInput, ListImportJob } from "./models";
import {
  checkEntries, buildEntryRow, insertEntriesTolerant, updateExistingEntries,
  resolveMemberIds, recountContactList, chunked, INSERT_CHUNK,
} from "./contactLists";
import type { EntryRow } from "./contactLists";
import type { ColumnMap, ImportEncoding, Delimiter, ListField } from "./listImportParse";

// ── 取り込みオプション ────────────────────────────────────────
/** 重複したときの動作。既定は skip（要件「エラーではじく」に最も近い） */
export type DupPolicy = "skip" | "update" | "abort";

export interface ImportOptions {
  dupPolicy: DupPolicy;
  /** CSVの空欄で既存値を上書きするか。⚠️ 重複挙動とは独立したフラグ。既定 false */
  blankOverwrite: boolean;
  /** 配信停止リストのアドレスを取り込まないか。既定 true */
  skipSuppressed: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  dupPolicy: "skip",
  blankOverwrite: false,
  skipSuppressed: true,
};

export const DUP_POLICY_LABEL: Record<DupPolicy, string> = {
  skip: "スキップする（取り込まない）",
  update: "既存レコードを更新する",
  abort: "1件でも重複があれば中止する",
};

// ── 検証（DBには書かない）────────────────────────────────────
export interface ValidateSummary {
  total: number;
  insert: number;
  update: number;
  skip: number;
  error: number;
  /** dupPolicy='abort' で重複が見つかり、実行を止めるべき状態か */
  abort: boolean;
}

export interface ValidateResult {
  rows: DupCheckRow[];
  summary: ValidateSummary;
}

/**
 * 取り込み前の検証。**DBには一切書かない**（要件「プレビューして問題なければ取り込む」）。
 * dupPolicy='update' のときは、既存レコードにあたった行を skip ではなく update に読み替える。
 */
export async function validateImport(
  listId: number,
  inputs: EntryInput[],
  opts: ImportOptions,
): Promise<ValidateResult> {
  const rows = await checkEntries(listId, inputs, { skipSuppressed: opts.skipSuppressed });

  if (opts.dupPolicy === "update") {
    for (const r of rows) {
      // 既存レコードに当たった行だけを update にする。
      // 入力内重複・配信停止によるスキップは update にしない（上書き先が無い／送ってはいけない）
      if (r.verdict === "skip" && r.existingId != null) {
        r.verdict = "update";
        r.reason = "既存レコードを更新します";
      }
    }
  }

  const summary = summarize(rows, opts.dupPolicy);
  return { rows, summary };
}

export function summarize(rows: DupCheckRow[], dupPolicy: DupPolicy): ValidateSummary {
  const insert = rows.filter((r) => r.verdict === "insert").length;
  const update = rows.filter((r) => r.verdict === "update").length;
  const skip = rows.filter((r) => r.verdict === "skip").length;
  const error = rows.filter((r) => r.verdict === "error").length;
  // abort は「既存との重複が1件でもあれば中止」。形式エラーは別に扱う
  const dupHit = rows.filter((r) => r.existingId != null).length;
  return {
    total: rows.length, insert, update, skip, error,
    abort: dupPolicy === "abort" && (dupHit > 0 || error > 0),
  };
}

// ── ジョブ行 ──────────────────────────────────────────────────
export function toImportJob(r: Tables<"contact_list_imports">): ListImportJob {
  const fk = r.file_kind;
  const st = r.status;
  return {
    id: r.id,
    listId: r.list_id,
    fileName: r.file_name ?? "",
    fileKind: fk === "paste" ? "paste" : fk === "md" ? "md" : "csv",
    encoding: r.encoding ?? "utf-8",
    delimiter: r.delimiter ?? ",",
    dupPolicy: r.dup_policy === "update" ? "update" : r.dup_policy === "abort" ? "abort" : "skip",
    blankOverwrite: r.blank_overwrite ?? false,
    skipSuppressed: r.skip_suppressed ?? true,
    totalRows: r.total_rows ?? 0,
    inserted: r.inserted ?? 0,
    updated: r.updated ?? 0,
    skipped: r.skipped ?? 0,
    failed: r.failed ?? 0,
    status: st === "running" || st === "done" || st === "failed" || st === "canceled" ? st : "queued",
    errorMessage: r.error_message ?? "",
    startedAt: r.started_at ?? "",
    finishedAt: r.finished_at ?? "",
    createdAt: r.created_at ?? "",
  };
}

/** 取込履歴（新しい順） */
export async function fetchImportJobs(listId: number): Promise<ListImportJob[]> {
  const { data, error } = await supabase
    .from("contact_list_imports")
    .select("*")
    .eq("list_id", listId)
    .order("id", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return data.map(toImportJob);
}

/** 失敗行（失敗CSVの生成元）。30日より古いジョブは中身を空にしている場合がある。 */
export interface StoredErrorRow { values: string[]; reason: string }

export async function fetchImportErrorRows(importId: number): Promise<StoredErrorRow[]> {
  const { data } = await supabase
    .from("contact_list_imports")
    .select("error_rows")
    .eq("id", importId)
    .maybeSingle();
  const raw = data?.error_rows;
  if (!Array.isArray(raw)) return [];
  const out: StoredErrorRow[] = [];
  for (const r of raw) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      const o = r as { values?: unknown; reason?: unknown };
      const values = Array.isArray(o.values) ? o.values.map((v) => String(v ?? "")) : [];
      out.push({ values, reason: typeof o.reason === "string" ? o.reason : "" });
    }
  }
  return out;
}

/**
 * ジョブ行に残した元のヘッダ（column_map.header）を取り出す。
 * 失敗行CSVを元の列構成のまま作り直すために使う。
 */
export async function fetchImportHeader(importId: number): Promise<string[]> {
  const { data } = await supabase
    .from("contact_list_imports")
    .select("column_map")
    .eq("id", importId)
    .maybeSingle();
  const cm = data?.column_map;
  if (cm && typeof cm === "object" && !Array.isArray(cm)) {
    const h = (cm as { header?: unknown }).header;
    if (Array.isArray(h)) return h.map((v) => String(v ?? ""));
  }
  return [];
}

/** ヘッダ行も一緒に残す（失敗CSVを元の列構成で再現するため） */
export interface ImportJobSeed {
  listId: number;
  fileName: string;
  fileKind: "csv" | "paste";
  encoding: ImportEncoding;
  delimiter: Delimiter;
  columnMap: ColumnMap;
  header: string[];
  totalRows: number;
  opts: ImportOptions;
}

export async function createImportJob(seed: ImportJobSeed): Promise<number | null> {
  const { data, error } = await supabase
    .from("contact_list_imports")
    .insert({
      list_id: seed.listId,
      file_name: seed.fileName,
      file_kind: seed.fileKind,
      encoding: seed.encoding,
      delimiter: seed.delimiter,
      // 失敗CSVを元の列構成で作り直せるよう、マッピングとヘッダを一緒に残す
      column_map: { map: seed.columnMap, header: seed.header } as unknown as Tables<"contact_list_imports">["column_map"],
      dup_policy: seed.opts.dupPolicy,
      blank_overwrite: seed.opts.blankOverwrite,
      skip_suppressed: seed.opts.skipSuppressed,
      total_rows: seed.totalRows,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

// ── 実行 ──────────────────────────────────────────────────────
export interface ImportProgress {
  /** 処理済みの行数（新規＋更新＋スキップ＋失敗） */
  done: number;
  total: number;
  inserted: number;
  updated: number;
}

export interface ImportRunResult {
  importId: number | null;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  canceled: boolean;
  errorMessage: string;
}

export interface RunImportArgs {
  listId: number;
  seed: Omit<ImportJobSeed, "listId" | "totalRows">;
  /** 検証済みの行（validateImport の結果をそのまま渡す） */
  rows: DupCheckRow[];
  /**
   * 元のCSVのデータ行（ヘッダを除く）。失敗行CSVを**元の全列のまま**再現するために使う。
   * ⚠️ 対応づけした列だけから復元すると、マッピングしていない列（社内管理Noなど）が
   *    失われて「修正してそのまま再アップロード」ができなくなる。
   */
  dataRows: string[][];
  /** 対応づけした項目（更新時にどの列を上書きするか） */
  fields: ListField[];
  opts: ImportOptions;
  onProgress?: (p: ImportProgress) => void;
  /** 中断要求（タブ閉じ・キャンセルボタン） */
  signal?: { aborted: boolean };
}

/**
 * 取り込みを実行する。
 *   ① ジョブ行を作る（running）
 *   ② 新規行を 500 件ずつ投入（会員の名寄せも 500 件単位で一括解決）
 *   ③ dupPolicy='update' の行を更新
 *   ④ 失敗行を error_rows に保存し、ジョブを done / canceled で閉じる
 *
 * ⚠️ 部分取込が既定（決定事項 No.6）。エラー行を除いた分は取り込む。
 */
export async function runImport(args: RunImportArgs): Promise<ImportRunResult> {
  const { listId, rows, fields, opts, onProgress, signal } = args;

  const inserts = rows.filter((r) => r.verdict === "insert");
  const updates = rows.filter((r) => r.verdict === "update" && r.existingId != null);
  const skipped = rows.filter((r) => r.verdict === "skip").length;
  const failedRows = rows.filter((r) => r.verdict === "error");

  const importId = await createImportJob({
    ...args.seed, listId, totalRows: rows.length,
  });

  let inserted = 0;
  let updated = 0;
  let canceled = false;
  let errorMessage = "";
  const doneBase = skipped + failedRows.length;
  const report = () => onProgress?.({
    done: doneBase + inserted + updated, total: rows.length, inserted, updated,
  });
  report();

  try {
    // ② 新規（500件ずつ：名寄せ → 行の組み立て → 投入）
    for (const chunk of chunked(inserts, INSERT_CHUNK)) {
      if (signal?.aborted) { canceled = true; break; }

      const memberMap = await resolveMemberIds(
        chunk.filter((c) => c.emailNorm)
          .map((c) => ({ raw: c.input.email.trim(), norm: c.emailNorm as string })),
      );
      const built = chunk
        .map((c) => buildEntryRow(
          listId, c.input, "csv",
          c.emailNorm ? memberMap.get(c.emailNorm) ?? null : null,
        ))
        .filter((r): r is EntryRow => r != null);

      inserted += await insertEntriesTolerant(built);
      report();
    }

    // ③ 更新（重複時の動作が update のときだけ）
    if (!canceled && updates.length > 0) {
      for (const chunk of chunked(updates, 100)) {
        if (signal?.aborted) { canceled = true; break; }
        updated += await updateExistingEntries(
          listId,
          chunk.map((c) => ({ existingId: c.existingId as number, input: c.input })),
          fields,
          opts.blankOverwrite,
        );
        report();
      }
    }
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : "取り込み中にエラーが発生しました";
  }

  await recountContactList(listId);

  // ④ ジョブを閉じる（失敗行は失敗CSVの生成元として保存する）
  if (importId != null) {
    const errorPayload = failedRows.map((r) => ({
      values: args.dataRows[r.no - 1] ?? [],
      reason: r.reason,
    }));
    await supabase.from("contact_list_imports").update({
      inserted, updated, skipped, failed: failedRows.length,
      error_rows: errorPayload as unknown as Tables<"contact_list_imports">["error_rows"],
      status: errorMessage ? "failed" : canceled ? "canceled" : "done",
      error_message: errorMessage || null,
      finished_at: new Date().toISOString(),
    }).eq("id", importId);
  }

  return {
    importId, inserted, updated, skipped, failed: failedRows.length,
    canceled, errorMessage,
  };
}
