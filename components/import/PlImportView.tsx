"use client";
// ============================================================
// 売上・経費の一括取込（独立ルート /ops/import・5ステップ）
//
//   ① ファイル選択   … CSV／MD。文字コード・区切りを自動判定。取込先を選ぶ
//   ② 列マッピング   … ヘッダ名から自動推測。手で直せる
//   ③ 検証・重複判定 … **DBには書かない**
//   ④ プレビュー確認 … 変換後の実データを全表示。重複は行ごとに「取り込む」へ変更可
//   ⑤ 取込実行・結果 … ジョブとして実行。ジョブ単位で取消できる
//
//   ＜設計の要点＞
//   ・重複は「完全ブロック」にしない。同一顧客が同日に同じ商品を2本買う正当なケースが
//     あるため、警告して人が選べるようにする。ただし外部取引ID一致だけは変更不可
//     （決済サイト発番の一意IDなので、一致＝確実に同じ取引）。
//   ・エラー行は取込対象から自動で外れる。理由は行の下に展開して出す。
//
//   ⚠️ 実行中はタブを閉じさせない。ブラウザから分割して入れているため。
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, ENCODING_LABEL, DELIMITER_LABEL,
  detectEncoding, decodeBytes, detectDelimiter, parseCsv, looksLikeHeader, buildErrorCsv,
} from "../../lib/listImportParse";
import type { Delimiter, ImportEncoding } from "../../lib/listImportParse";
import {
  TARGET_LABEL, VERDICT_LABEL, autoMapPlColumns, fieldsFor, fileHash,
  hasRequiredPlMapping, hashAlgo, missingRequired, parseMarkdownTables, summarizePl,
  unknownMasterNames, validateRows, willImport,
  type ImportTarget, type MdTable, type PlColumnMap, type PlField, type PlImportRow,
} from "../../lib/plImport";
import {
  addMasterByName, fetchImportJobs, findJobsByFileHash, importAvailable, loadExisting,
  loadMemberIndex, runPlImport, undoImportJob, JOB_STATUS_LABEL,
  type ImportJob, type PastJob, type RunResult,
} from "../../lib/plImportRun";
import { fetchMasterOptions, formatYen, fetchPayments } from "../../lib/payments";
import { fetchExpenseCategories, fetchExpenses } from "../../lib/expenses";
import {
  autoMapCashColumns, cashFieldsFor, hasRequiredCashMapping, missingCashRequired,
  summarizeCash, validateCashRows, willImportCash, MODE_HINT, MODE_LABEL,
  type CashColumnMap, type CashField, type CashImportGroup, type CashImportMode,
} from "../../lib/cashImport";
import {
  cashImportAvailable, loadExistingCash, runCashImport, undoCashImport,
} from "../../lib/cashImportRun";
import { buildCandidates, fetchCashEntries, settlementMap } from "../../lib/cash";
import { sha256Hex } from "../../lib/plImport";
import { CashImportPreview } from "./CashImportPreview";
import type { CashEntry, ExpenseCategory, PaymentMaster } from "../../lib/models";
import { useMaster } from "../../hooks/useMaster";
import { useToast } from "../common/ToastProvider";
import { useConfirm } from "../common/ConfirmProvider";
import { FIELD_INPUT } from "../../lib/constants";
const input = FIELD_INPUT;

type Step = 1 | 2 | 3 | 4 | 5;
/** 入出金は明細ではなく着金バッチなので、売上・経費とは別扱いにする */
type WizardTarget = ImportTarget | "cash";
const WIZARD_TARGET_LABEL: Record<WizardTarget, string> = {
  ...TARGET_LABEL, cash: "入出金",
};
type PreviewFilter = "all" | "ok" | "dup" | "error";

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "ファイル選択" }, { n: 2, label: "列マッピング" },
  { n: 3, label: "検証・重複判定" }, { n: 4, label: "プレビュー確認" }, { n: 5, label: "取込実行" },
];

const verdictPill: Record<string, string> = {
  ok:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  dup_ext:  "bg-amber-50 text-amber-700 border-amber-200",
  dup_key:  "bg-amber-50 text-amber-700 border-amber-200",
  dup_file: "bg-amber-50 text-amber-700 border-amber-200",
  error:    "bg-red-50 text-red-700 border-red-200",
};

const btn = "px-4 py-2 rounded-lg text-sm font-semibold";
const btnGhost = `${btn} border border-gray-300 text-gray-600 hover:bg-gray-50`;
const btnMain = `${btn} bg-red-600 text-white hover:bg-red-700 disabled:opacity-40`;

export function PlImportView() {
  const { can } = useMaster();
  const toast = useToast();
  const confirm = useConfirm();
  const canUndo = can("pl_import_undo");
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  /** 取込先。売上・経費は明細、入出金は着金バッチ（粒度が違う） */
  const [target, setTarget] = useState<WizardTarget>("sales");
  const isCash = target === "cash";

  // ── 入出金モードの設定 ──
  const [cashMode, setCashMode] = useState<CashImportMode>("breakdown");
  const [cashDirection, setCashDirection] = useState<"in" | "out">("in");
  const [cashSiteId, setCashSiteId] = useState<number | null>(null);
  const [cashMap, setCashMap] = useState<CashColumnMap>([]);
  const [groups, setGroups] = useState<CashImportGroup[]>([]);

  // ── STEP1：ファイル ──
  const [fileName, setFileName] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState<ImportEncoding>("utf-8");
  const [detected, setDetected] = useState<ImportEncoding | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [isMd, setIsMd] = useState(false);
  const [mdTables, setMdTables] = useState<MdTable[]>([]);
  const [mdPick, setMdPick] = useState(0);
  const [fileError, setFileError] = useState("");
  const [hash, setHash] = useState("");
  const [pastJobs, setPastJobs] = useState<PastJob[]>([]);

  // ── STEP2 ──
  const [map, setMap] = useState<PlColumnMap>([]);
  const [autoCalc, setAutoCalc] = useState(true);

  // ── STEP3・4 ──
  const [rows, setRows] = useState<PlImportRow[]>([]);
  const [validating, setValidating] = useState(false);
  const [keyUnavailable, setKeyUnavailable] = useState(false);
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [open, setOpen] = useState<Set<number>>(new Set());

  // ── STEP5 ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  /** 入出金の取込で作られた消込の件数 */
  const [cashAllocs, setCashAllocs] = useState(0);

  // ── マスタ・履歴 ──
  const [types, setTypes] = useState<PaymentMaster[]>([]);
  const [sites, setSites] = useState<PaymentMaster[]>([]);
  const [methods, setMethods] = useState<PaymentMaster[]>([]);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  /** 入出金の内訳モードで、決済IDから売上・経費を引き当てるための素材 */
  const [candidateSrc, setCandidateSrc] = useState<{ entries: CashEntry[] } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [cashUnavailable, setCashUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadMasters = useCallback(async () => {
    const [m, cs] = await Promise.all([
      fetchMasterOptions(),
      fetchExpenseCategories().catch(() => [] as ExpenseCategory[]),
    ]);
    setTypes(m.types); setSites(m.sites); setMethods(m.methods); setCats(cs);
  }, []);

  const loadJobs = useCallback(async () => {
    const js = await fetchImportJobs();
    setJobs(js);
    setUnavailable(importAvailable() === false);
    // 既存の入出金は「二重消込を防ぐための消込済み額」を作るのに使う
    setCandidateSrc({ entries: await fetchCashEntries().catch(() => []) });
  }, []);

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadMasters(), loadJobs()]); }
      catch (e) { console.error("一括取込の初期化エラー:", e); }
      setLoading(false);
    })();
  }, [loadMasters, loadJobs]);

  // 実行中の離脱を止める（分割して入れている途中で閉じられると中途半端に残る）
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  // ── 解析 ──
  const text = useMemo(() => (bytes ? decodeBytes(bytes, encoding) : ""), [bytes, encoding]);

  const allRows = useMemo<string[][]>(() => {
    if (!text) return [];
    if (isMd) return mdTables[mdPick]?.rows ?? [];
    return parseCsv(text, delimiter);
  }, [text, isMd, mdTables, mdPick, delimiter]);

  const header = useMemo<string[]>(
    () => (hasHeader ? allRows[0] ?? [] : (allRows[0] ?? []).map((_, i) => `列${i + 1}`)),
    [allRows, hasHeader],
  );
  const dataRows = useMemo(() => (hasHeader ? allRows.slice(1) : allRows), [allRows, hasHeader]);

  const reset = () => {
    setStep(1); setBytes(null); setFileName(""); setRows([]); setResult(null);
    setMap([]); setMdTables([]); setMdPick(0); setIsMd(false); setHash(""); setPastJobs([]);
    setOpen(new Set()); setFilter("all"); setFileError("");
    setCashMap([]); setGroups([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    setFileError(""); setRows([]); setResult(null); setPastJobs([]);
    if (f.size > IMPORT_MAX_BYTES) {
      setFileError(`ファイルが大きすぎます（上限 ${Math.floor(IMPORT_MAX_BYTES / 1024 / 1024)}MB）`);
      return;
    }
    const buf = new Uint8Array(await f.arrayBuffer());
    const enc = detectEncoding(buf);
    const md = /\.mdx?$/i.test(f.name);
    const decoded = decodeBytes(buf, enc);

    setBytes(buf); setFileName(f.name); setEncoding(enc); setDetected(enc); setIsMd(md);
    if (md) {
      const tables = parseMarkdownTables(decoded);
      setMdTables(tables); setMdPick(0);
      if (!tables.length) setFileError("このMDファイルの中に表が見つかりませんでした。");
    } else {
      setMdTables([]);
      setDelimiter(detectDelimiter(decoded));
    }
    const rowsPeek = md ? [] : parseCsv(decoded, detectDelimiter(decoded));
    if (rowsPeek.length) setHasHeader(looksLikeHeader(rowsPeek[0]));

    const h = await fileHash(buf);
    setHash(h);
    setPastJobs(await findJobsByFileHash(h));
  };

  // ヘッダが変わったら列マッピングを引き直す
  useEffect(() => {
    if (!header.length) return;
    if (isCash) setCashMap(autoMapCashColumns(header, cashMode));
    else setMap(autoMapPlColumns(header, target as ImportTarget));
  }, [header, target, isCash, cashMode]);

  const mappingOk = isCash
    ? hasRequiredCashMapping(cashMap, cashMode)
    : hasRequiredPlMapping(map, target as ImportTarget);
  const lacking = isCash
    ? missingCashRequired(cashMap, cashMode)
    : missingRequired(map, target as ImportTarget);

  const doValidate = async () => {
    if (dataRows.length > IMPORT_MAX_ROWS) {
      toast.error(`行数が上限（${IMPORT_MAX_ROWS.toLocaleString("ja-JP")}行）を超えています`);
      return;
    }
    setValidating(true); setStep(3);
    try {
      if (isCash) { await validateCash(); setStep(4); setValidating(false); return; }
      const [ex, members] = await Promise.all([loadExisting(target as ImportTarget), loadMemberIndex()]);
      setKeyUnavailable(ex.keyUnavailable);
      const rs = await validateRows({
        target: target as ImportTarget, dataRows, map,
        masters: { types, sites, methods, categories: cats },
        existingExt: ex.ext, existingKey: ex.key, members, autoCalc,
      });
      setRows(rs);
      setStep(4);
    } catch (e) {
      toast.error(`検証に失敗しました：${e instanceof Error ? e.message : String(e)}`);
      setStep(2);
    }
    setValidating(false);
  };

  /**
   * 入出金の検証。
   * 内訳モードでは決済IDで売上・経費に引き当てるため、
   * 既存の消込済み額（settlementMap）を差し引いた「残額」で候補を作る。
   */
  const validateCash = async () => {
    const [existing, pays, exs] = await Promise.all([
      loadExistingCash(),
      cashMode === "breakdown" ? fetchPayments() : Promise.resolve([]),
      cashMode === "breakdown" ? fetchExpenses().catch(() => []) : Promise.resolve([]),
    ]);

    // 既存の入出金から消込済み額を作る（同じ決済を二重に消し込まないため）
    const settled = settlementMap(candidateSrc?.entries ?? []);
    const candidates = cashMode === "breakdown"
      ? [...buildCandidates("in", pays, [], settled), ...buildCandidates("out", [], exs, settled)]
      : [];

    // 既存の自然キーを作る（画面側でハッシュ化してから渡す）
    const keyEntries = await Promise.all(existing.rows.map(async (r) => {
      const key = [r.direction, r.entryDate, String(r.siteId ?? ""), String(r.amount),
        r.description.trim().toLowerCase()].join("\u001f");
      return [await sha256Hex(key), r.id] as const;
    }));

    const gs = await validateCashRows({
      mode: cashMode, dataRows, map: cashMap,
      defaultDirection: cashDirection, sites, defaultSiteId: cashSiteId,
      existingPayouts: existing.payouts,
      existingKeys: new Map(keyEntries),
      candidates,
    });
    setGroups(gs);
    setCashUnavailable(cashImportAvailable() === false);
  };

  const summary = useMemo(() => summarizePl(rows), [rows]);
  const cashSummary = useMemo(() => summarizeCash(groups), [groups]);
  const view = isCash
    ? { ok: cashSummary.ok, dup: cashSummary.dup, error: cashSummary.error, total: groups.length }
    : { ok: summary.ok, dup: summary.dup, error: summary.error, total: rows.length };
  const unknowns = useMemo(() => unknownMasterNames(rows), [rows]);

  const shown = useMemo(() => rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "error") return r.verdict === "error";
    if (filter === "ok") return willImport(r);
    return r.verdict !== "error" && !willImport(r);
  }), [rows, filter]);

  const toggleOverride = (no: number) => {
    setRows((prev) => prev.map((r) => (r.no === no && r.canOverride ? { ...r, override: !r.override } : r)));
  };
  const toggleCashOverride = (no: number) => {
    setGroups((prev) => prev.map((g) => (g.no === no && g.canOverride ? { ...g, override: !g.override } : g)));
  };
  const toggleOpen = (no: number) => {
    setOpen((prev) => { const s = new Set(prev); s.has(no) ? s.delete(no) : s.add(no); return s; });
  };

  const onErrorCsv = () => {
    const failed = rows.filter((r) => r.verdict === "error")
      .map((r) => ({ values: r.raw, reason: r.reasons.join(" / ") }));
    if (!failed.length) return;
    const blob = new Blob([buildErrorCsv(header, failed)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `取込エラー_${fileName || "import"}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const addMaster = async (label: string, name: string) => {
    const kind = label.includes("商品") ? "type"
      : label.includes("科目") ? "category"
        : label.includes("サイト") ? "site" : "method";
    const res = await addMasterByName(kind, name);
    if (res.id == null) { toast.error(`追加に失敗しました：${res.error}`); return; }
    await loadMasters();
    toast.success(`「${name}」を追加しました。もう一度「検証する」を押してください`);
  };

  const doRun = async () => {
    if (!view.ok) { toast.error("取り込む行がありません"); return; }
    setRunning(true); setStep(5); setProgress({ done: 0, total: view.ok });

    if (isCash) {
      const res = await runCashImport(
        { fileName, fileHash: hash, mapping: { mode: cashMode, map: cashMap }, groups },
        (done, total) => setProgress({ done, total }),
      );
      setResult({ jobId: res.jobId, ok: res.ok, skipped: res.skipped, errored: res.errored, failures: res.failures, error: res.error });
      setCashAllocs(res.allocations);
      setRunning(false);
      await loadJobs();
      if (res.jobId == null) toast.error(`取込に失敗しました：${res.error}`);
      else toast.success(`${res.ok}件の入出金と ${res.allocations}件の消込を作りました`);
      return;
    }

    const res = await runPlImport(
      { target: target as ImportTarget, fileName, fileHash: hash, map, rows },
      (done, total) => setProgress({ done, total }),
    );
    setResult(res);
    setRunning(false);
    await loadJobs();
    if (res.jobId == null) toast.error(`取込に失敗しました：${res.error}`);
    else toast.success(`${res.ok}件を取り込みました`);
  };

  const doUndo = async (j: ImportJob) => {
    if (!(await confirm({
      title: "取込を取り消す",
      message: `「${j.fileName}」で取り込んだ ${j.okCount}件を取り消します。消込済みの行は残ります。`,
      confirmLabel: "取り消す", danger: true,
    }))) return;
    if (j.target === "cash") {
      const cr = await undoCashImport(j.id);
      if (cr.error) { toast.error(`取消に失敗しました：${cr.error}`); return; }
      await loadJobs();
      toast.success(cr.lockedByShare
        ? `${cr.undone}件を取り消しました。${cr.lockedByShare}件は利益分配が確定済みのため残しています`
        : `${cr.undone}件の入出金と、ひも付く消込を取り消しました`);
      return;
    }
    const res = await undoImportJob(j.id, j.target);
    if (res.error) { toast.error(`取消に失敗しました：${res.error}`); return; }
    await loadJobs();
    const kept: string[] = [];
    if (res.locked) kept.push(`${res.locked}件は消込済み`);
    if (res.lockedByShare) kept.push(`${res.lockedByShare}件は利益分配が確定済み`);
    toast.success(kept.length
      ? `${res.undone}件を取り消しました。${kept.join("・")}のため残しています`
      : `${res.undone}件を取り消しました`);
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">一括取込</h1>
        <span className="text-xs text-gray-400">
          CSV／MD から{WIZARD_TARGET_LABEL[target]}を取り込みます。取り込む前に必ずプレビューで確認できます。
        </span>
        <div className="flex-1" />
        {step > 1 && <button onClick={reset} className={btnGhost}>最初からやり直す</button>}
      </div>

      {unavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[12.5px] font-bold text-amber-800">取込ジョブのテーブルがまだありません</div>
          <p className="text-[11.5px] text-amber-700 mt-1">
            この画面を使うには <code className="font-mono">supabase/migration_add_pl_ledger.sql</code> の適用が必要です。
            適用すると、取込の実行と<b>ジョブ単位の取消</b>が使えるようになります。
          </p>
        </div>
      )}

      {/* ステップ表示 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1.5">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold ${step === s.n
              ? "bg-red-600 text-white"
              : step > s.n ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-gray-50 text-gray-400 border border-gray-200"}`}>
              <span>{step > s.n ? "✓" : s.n}</span>{s.label}
            </div>
            {i < STEPS.length - 1 && <span className="text-gray-300 text-[11px]">→</span>}
          </div>
        ))}
      </div>

      {/* ══ STEP1 ══ */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">取込先</label>
            <div className="flex gap-1.5">
              {(["sales", "expense", "cash"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTarget(t)}
                  className={`px-4 py-2 rounded-lg border text-[12.5px] font-semibold ${target === t
                    ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                  {WIZARD_TARGET_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {isCash
                ? "入出金は着金・送金 1件＝1行（バッチ）です。売上・経費の明細とは粒度が違います。"
                : "売上・経費は取引明細 1件＝1行です。"}
            </p>
          </div>

          {isCash && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2.5">
              <div className="text-[11px] font-bold text-indigo-800">ファイルの形</div>
              <div className="flex flex-col gap-1.5">
                {(["entry", "breakdown"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setCashMode(m)}
                    className={`text-left px-3 py-2 rounded-lg border text-[12.5px] ${cashMode === m
                      ? "border-indigo-300 bg-white text-indigo-800 font-semibold"
                      : "border-transparent bg-white/60 text-gray-600 hover:bg-white"}`}>
                    {MODE_LABEL[m]}
                    <span className="block text-[11px] font-normal text-gray-500 mt-0.5">{MODE_HINT[m]}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-indigo-700 leading-relaxed">
                ⚠️ 形を取り違えると、<b>1決済ぶんの金額で着金が大量に作られます</b>。
                ファイルの1行が何を表しているか確かめてから選んでください。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-indigo-200">
                <div>
                  <label className="text-[11px] text-indigo-800 block mb-1">既定の区分</label>
                  <div className="flex gap-1.5">
                    {(["in", "out"] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setCashDirection(d)}
                        className={`flex-1 px-2 py-2 rounded-lg border text-[12px] font-semibold ${cashDirection === d
                          ? "border-indigo-300 bg-white text-indigo-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                        {d === "in" ? "入金" : "出金"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-indigo-700 mt-1">区分の列がある場合はそちらを優先します。</p>
                </div>
                <div>
                  <label className="text-[11px] text-indigo-800 block mb-1">既定の経路（サイト）</label>
                  <select className={`${input} bg-white`} value={cashSiteId ?? ""}
                    onChange={(e) => setCashSiteId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">（未選択）</option>
                    {sites.filter((x) => !x.isDeleted).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <p className="text-[11px] text-indigo-700 mt-1">振込手数料の照合に使います。</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1.5">ファイル</label>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.md,.mdx"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
            <p className="text-[11px] text-gray-400 mt-1">
              CSV／TSV／Markdown（表）。上限 {Math.floor(IMPORT_MAX_BYTES / 1024 / 1024)}MB・{IMPORT_MAX_ROWS.toLocaleString("ja-JP")}行。
            </p>
          </div>

          {fileError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{fileError}</div>
          )}

          {pastJobs.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="text-[12.5px] font-bold text-amber-800">同じ内容のファイルを取り込み済みです</div>
              <ul className="text-[11.5px] text-amber-700 mt-1 space-y-0.5">
                {pastJobs.map((j) => (
                  <li key={j.id}>・{(j.createdAt || "").slice(0, 10)}　{j.fileName}　{j.okCount}件</li>
                ))}
              </ul>
              <p className="text-[11.5px] text-amber-700 mt-1.5">
                続けることもできますが、<b>二重登録になっていないか</b>プレビューで必ず確認してください。
              </p>
            </div>
          )}

          {bytes && !fileError && (
            <div className="rounded-xl border border-gray-200 bg-[#fafafa] p-3 space-y-2.5">
              <div className="text-[11px] font-bold text-gray-500">読み取り設定（自動判定。合わなければ直してください）</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1">文字コード</label>
                  <select className={`${input} bg-white`} value={encoding}
                    onChange={(e) => setEncoding(e.target.value as ImportEncoding)}>
                    {(Object.keys(ENCODING_LABEL) as ImportEncoding[]).map((k) => (
                      <option key={k} value={k}>{ENCODING_LABEL[k]}{detected === k ? "（自動判定）" : ""}</option>
                    ))}
                  </select>
                </div>
                {!isMd && (
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">区切り文字</label>
                    <select className={`${input} bg-white`} value={delimiter}
                      onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
                      {(Object.keys(DELIMITER_LABEL) as Delimiter[]).map((k) => (
                        <option key={k} value={k}>{DELIMITER_LABEL[k]}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isMd && mdTables.length > 1 && (
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">取り込む表</label>
                    <select className={`${input} bg-white`} value={mdPick}
                      onChange={(e) => setMdPick(Number(e.target.value))}>
                      {mdTables.map((t, i) => (
                        <option key={i} value={i}>{t.caption || `表${i + 1}`}（{t.rows.length - 1}行）</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)}
                      className="w-4 h-4 accent-red-600" />
                    1行目は見出し
                  </label>
                </div>
              </div>

              {isMd && mdTables[mdPick]?.hasEscapedPipe && (
                <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  セル内に <code className="font-mono">\|</code> を含む値があります。列が意図どおりに割れているか、
                  下の読み取り結果で確かめてください。
                </p>
              )}

              <div className="text-[12px] text-gray-600">
                <b>{fileName}</b>　{dataRows.length.toLocaleString("ja-JP")}行（見出しを除く）・{header.length}列
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!bytes || !!fileError || !dataRows.length} className={btnMain}>
              次へ：列を対応づける
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP2 ══ */}
      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="text-[12.5px] text-gray-600">
            ファイルの列を、システムの項目に対応づけます。見出し名から推測済みです。
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0">
                <tr className="bg-gray-700 text-gray-100">
                  <th className="text-left font-bold px-3 py-2 w-12">列</th>
                  <th className="text-left font-bold px-3 py-2">ファイルの見出し</th>
                  <th className="text-left font-bold px-3 py-2">1行目の値</th>
                  <th className="text-left font-bold px-3 py-2 w-[220px]">取り込み先</th>
                </tr>
              </thead>
              <tbody>
                {header.map((h, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-1.5 text-gray-800 font-semibold max-w-[200px] truncate" title={h}>{h || "（空）"}</td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-[220px] truncate" title={dataRows[0]?.[i] ?? ""}>
                      {dataRows[0]?.[i] || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {isCash ? (
                        <select className={`${input} bg-white py-1.5 text-[12px]`} value={cashMap[i] ?? ""}
                          onChange={(e) => {
                            const v = (e.target.value || null) as CashField | null;
                            setCashMap((prev) => prev.map((x, j) => (j === i ? v : x === v && v != null ? null : x)));
                          }}>
                          <option value="">（取り込まない）</option>
                          {cashFieldsFor(cashMode).map((f) => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? " ※必須" : ""}</option>
                          ))}
                        </select>
                      ) : (
                        <select className={`${input} bg-white py-1.5 text-[12px]`} value={map[i] ?? ""}
                          onChange={(e) => {
                            const v = (e.target.value || null) as PlField | null;
                            setMap((prev) => prev.map((x, j) => (j === i ? v : x === v && v != null ? null : x)));
                          }}>
                          <option value="">（取り込まない）</option>
                          {fieldsFor(target as ImportTarget).map((f) => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? " ※必須" : ""}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!mappingOk && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              必須項目が未対応づけです：{lacking.join("・")}
            </div>
          )}

          {isCash && (
            <div className="rounded-xl border border-gray-200 bg-[#fafafa] px-3 py-2.5">
              <div className="text-[11px] font-bold text-gray-500 mb-1">項目の意味</div>
              <ul className="text-[11.5px] text-gray-600 space-y-0.5">
                {cashFieldsFor(cashMode).filter((f) => f.hint).map((f) => (
                  <li key={f.key}>・<b>{f.label}</b>：{f.hint}</li>
                ))}
              </ul>
            </div>
          )}

          <label className={`flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer ${isCash ? "hidden" : ""}`}>
            <input type="checkbox" checked={autoCalc} onChange={(e) => setAutoCalc(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-red-600" />
            <span>
              手数料・入出金予定日を決済サイトの設定から自動計算する
              <span className="block text-[11px] text-gray-400 mt-0.5">
                ファイルに該当の列がある場合は、そちらを優先します。
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button onClick={() => setStep(1)} className={btnGhost}>戻る</button>
            <div className="flex-1" />
            <button onClick={doValidate} disabled={!mappingOk} className={btnMain}>検証する</button>
          </div>
        </div>
      )}

      {/* ══ STEP3 ══ */}
      {step === 3 && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-12 text-center">
          <div className="text-sm font-bold text-gray-700">{validating ? "検証しています…" : "準備中…"}</div>
          <p className="text-[12px] text-gray-500 mt-2">
            既存データと突き合わせて重複を判定しています。<b>この時点ではまだ書き込んでいません。</b>
          </p>
        </div>
      )}

      {/* ══ STEP4 ══ */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">取込する</div><div className="text-xl font-bold text-emerald-700">{view.ok} 件</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">重複でスキップ</div><div className="text-xl font-bold text-amber-600">{view.dup} 件</div></div>
            <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">エラーで除外</div><div className="text-xl font-bold text-red-600">{view.error} 件</div></div>
            {isCash ? (
              <>
                <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">入出金の合計</div><div className="text-xl font-bold text-gray-800">{formatYen(cashSummary.amount)}</div></div>
                <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">作られる消込</div><div className="text-xl font-bold text-gray-800">{cashSummary.allocations} 件</div></div>
              </>
            ) : (
              <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">取込後の計上額</div><div className="text-xl font-bold text-gray-800">{formatYen(summary.recognized)}</div></div>
            )}
          </div>

          {isCash && cashUnavailable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11.5px] text-amber-800">
              入出金テーブルがまだありません。<code className="font-mono">migration_add_pl_ledger.sql</code> の適用が必要です。
            </div>
          )}

          {isCash && cashSummary.needsReview > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11.5px] text-red-700">
              <b>差額が許容枠を超えている入出金が {cashSummary.needsReview} 件あります。</b>
              消込の内容と実着金額を確認してから取り込んでください。下の一覧で赤く出ています。
            </div>
          )}

          {keyUnavailable && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[11.5px] text-amber-800">
              <b>自然キーによる重複判定ができていません。</b>
              <code className="font-mono">dedup_hash</code> 列がまだ無いため、外部取引IDが一致する行しか重複と判定できません。
              マイグレーション適用後にもう一度検証してください。
            </div>
          )}

          {hashAlgo() === "fallback" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[11.5px] text-amber-800">
              この環境では SHA-256 が使えないため、簡易ハッシュで重複を判定しています（https の本番環境では SHA-256 を使います）。
            </div>
          )}

          {unknowns.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="text-[12.5px] font-bold text-red-800">マスタに無い名称があります</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {unknowns.map((u) => {
                  const [label, name] = u.split("：");
                  return (
                    <button key={u} type="button" onClick={() => addMaster(label, name)}
                      className="text-[11.5px] px-2.5 py-1 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100">
                      ＋ {label}に「{name}」を追加
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-red-700 mt-2">追加したら、もう一度「検証する」を押してください。</p>
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            {([["all", `すべて（${view.total}）`], ["ok", `取込対象（${view.ok}）`],
               ["dup", `重複（${view.dup}）`], ["error", `エラー（${view.error}）`]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setFilter(v)}
                className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${filter === v
                  ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {l}
              </button>
            ))}
            <div className="flex-1" />
            {!isCash && summary.error > 0 && (
              <button onClick={onErrorCsv} className={btnGhost}>エラー行をCSVで書き出す</button>
            )}
          </div>

          {isCash ? (
            <CashImportPreview
              groups={groups}
              mode={cashMode}
              sites={sites}
              filter={filter}
              onToggleOverride={toggleCashOverride}
            />
          ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0">
                  <tr className="bg-gray-700 text-gray-100">
                    <th className="text-left font-bold px-3 py-2 w-10">#</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">判定</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">決済日時</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">計上日</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">予定日</th>
                    <th className="text-left font-bold px-3 py-2">{target === "sales" ? "メール・氏名" : "支払先"}</th>
                    <th className="text-left font-bold px-3 py-2">{target === "sales" ? "商品種別" : "経費科目"}</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">総額</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">手数料</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">計上額</th>
                    {target === "sales" && <th className="text-left font-bold px-3 py-2 whitespace-nowrap">会員照合</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const v = r.value;
                    const isOpen = open.has(r.no) || r.verdict !== "ok";
                    const label = willImport(r) ? "取込" : VERDICT_LABEL[r.verdict];
                    const pill = willImport(r) ? verdictPill.ok : verdictPill[r.verdict];
                    return (
                      // 行と理由行の2つを返すため Fragment で包む（key はここに付ける）
                      <Fragment key={r.no}>
                        <tr className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-1.5 text-gray-400">{r.no}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <button type="button" onClick={() => toggleOpen(r.no)}
                              className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${pill}`}>
                              {label}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{v.paidAt.replace("T", " ") || "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{v.accrualDate || "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{v.expectedDate || "—"}</td>
                          <td className="px-3 py-1.5 max-w-[220px]">
                            <div className="text-gray-800 font-semibold truncate">
                              {target === "sales" ? (v.customerName || v.email || "—") : (v.vendorName || "—")}
                            </div>
                            {target === "sales" && v.email && (
                              <div className="text-[10.5px] text-gray-400 truncate">{v.email}</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-gray-600 max-w-[160px] truncate">
                            {target === "sales"
                              ? types.find((t) => t.id === v.typeId)?.name ?? "—"
                              : cats.find((c) => c.id === v.categoryId)?.name ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{v.amount ? formatYen(v.amount) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-red-500">{v.feeAmount ? `−${formatYen(v.feeAmount)}` : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-gray-800">{v.recognizedAmount ? formatYen(v.recognizedAmount) : "—"}</td>
                          {target === "sales" && (
                            <td className="px-3 py-1.5 whitespace-nowrap text-[11px]">
                              {v.memberId != null
                                ? <span className="text-emerald-700 font-semibold">#{v.memberId}</span>
                                : <span className="text-gray-400">未照合</span>}
                            </td>
                          )}
                        </tr>
                        {isOpen && r.reasons.length > 0 && (
                          <tr className="bg-[#fafafa]">
                            <td />
                            <td colSpan={target === "sales" ? 10 : 9} className="px-3 pb-2 pt-0">
                              <div className="text-[11.5px] text-gray-600 leading-relaxed">
                                {r.reasons.map((m, k) => <div key={k}>└ {m}</div>)}
                                {r.canOverride && (
                                  <label className="inline-flex items-center gap-1.5 mt-1 text-[11.5px] text-gray-700 cursor-pointer">
                                    <input type="checkbox" checked={r.override} onChange={() => toggleOverride(r.no)}
                                      className="w-3.5 h-3.5 accent-emerald-600" />
                                    この行はやはり取り込む
                                    <span className="text-gray-400">（同日に2件購入した等、正当な重複の場合）</span>
                                  </label>
                                )}
                                {r.verdict === "dup_ext" && (
                                  <div className="text-gray-400 mt-0.5">→ スキップ（外部取引IDの一致は変更できません）</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={() => setStep(2)} className={btnGhost}>戻る（マッピングを直す）</button>
            <div className="flex-1" />
            <button onClick={doRun} disabled={!view.ok || unavailable || (isCash && cashUnavailable)} className={btnMain}>
              {isCash ? `${view.ok}件の入出金を取り込む` : `${view.ok}件を取り込む`}
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP5 ══ */}
      {step === 5 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          {running ? (
            <div className="py-8 text-center">
              <div className="text-sm font-bold text-gray-700">取り込んでいます… {progress.done} / {progress.total}</div>
              <div className="mt-3 mx-auto max-w-md h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-red-500 transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <p className="text-[12px] text-gray-500 mt-3">このタブを閉じないでください。</p>
            </div>
          ) : result ? (
            <>
              <div className="text-base font-bold text-gray-800">
                {result.jobId == null ? "取込に失敗しました" : "取込が完了しました"}
              </div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
                <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">取り込んだ</div><div className="text-xl font-bold text-emerald-700">{result.ok} 件</div></div>
                <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">重複でスキップ</div><div className="text-xl font-bold text-amber-600">{result.skipped} 件</div></div>
                <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">エラー</div><div className="text-xl font-bold text-red-600">{result.errored} 件</div></div>
                {isCash && (
                  <div className="bg-[#faf9f7] rounded-xl px-4 py-3"><div className="text-[11px] text-gray-500">作った消込</div><div className="text-xl font-bold text-gray-800">{cashAllocs} 件</div></div>
                )}
              </div>
              {result.failures.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
                  登録できなかった行：
                  {result.failures.slice(0, 10).map((f) => <div key={f.no}>└ {f.no}行目：{f.reason}</div>)}
                  {result.failures.length > 10 && <div>ほか {result.failures.length - 10} 件</div>}
                </div>
              )}
              <p className="text-[12px] text-gray-500">
                取り違えていた場合は、下の履歴から<b>この取込をまるごと取り消せます</b>（消込済みの行は残ります）。
              </p>
              <div className="flex justify-end"><button onClick={reset} className={btnMain}>続けて取り込む</button></div>
            </>
          ) : null}
        </div>
      )}

      {/* ══ 履歴 ══ */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-gray-700">取込履歴</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gray-700 text-gray-100">
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">日時</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">取込先</th>
                    <th className="text-left font-bold px-3 py-2">ファイル</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">取込</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">スキップ</th>
                    <th className="text-right font-bold px-3 py-2 whitespace-nowrap">エラー</th>
                    <th className="text-left font-bold px-3 py-2 whitespace-nowrap">状態</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const undoable = canUndo && j.okCount > 0 && j.status !== "reverted";
                    return (
                      <tr key={j.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{(j.createdAt || "").slice(0, 16).replace("T", " ")}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{WIZARD_TARGET_LABEL[j.target]}</td>
                        <td className="px-3 py-2 text-gray-800 max-w-[280px] truncate" title={j.fileName}>{j.fileName || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-semibold">{j.okCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{j.skipCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-500">{j.errorCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{JOB_STATUS_LABEL[j.status] ?? j.status}</td>
                        <td className="px-3 py-2 text-right">
                          {undoable && (
                            <button onClick={() => doUndo(j)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">取消</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
