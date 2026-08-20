"use client";
// ============================================================
// リスト一括取り込みウィザード（CSV・4ステップ）
//   ① ファイル選択（文字コード・区切り・ヘッダ行を自動判定して見せる）
//   ② 列の対応づけ（ヘッダ名から自動推定・重複時の動作を選ぶ）
//   ③ プレビュー・確認（**DBには書かない**検証結果を行単位で見せる）
//   ④ 結果（失敗理由付きCSVのダウンロード）
//
//   ⚠️ Markdown は Phase 5。.md を選ばれたら「未対応」と明示して弾く（黙って失敗させない）。
//   ⚠️ 取り込みはブラウザ側で 500 件ずつ実行する。実行中はタブを閉じないよう明示する。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../common/Icon";
import type { ContactList, DupCheckRow } from "../../lib/models";
import {
  IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_PREVIEW_ROWS,
  LIST_FIELDS, ENCODING_LABEL, DELIMITER_LABEL,
  detectEncoding, decodeBytes, detectDelimiter, parseCsv, looksLikeHeader,
  autoMapColumns, rowsToEntryInputs, hasRequiredMapping, mappedFields,
  buildErrorCsv, collectFailedRows,
} from "../../lib/listImportParse";
import type { ColumnMap, Delimiter, ImportEncoding, ListField } from "../../lib/listImportParse";
import {
  DEFAULT_IMPORT_OPTIONS, DUP_POLICY_LABEL, validateImport, runImport,
} from "../../lib/listImportRun";
import { setListConsentNoteIfEmpty } from "../../lib/contactLists";
import type { DupPolicy, ImportOptions, ImportRunResult, ValidateSummary } from "../../lib/listImportRun";

export interface ListImportWizardProps {
  list: ContactList;
  onClose: () => void;
  /** 取り込みが完了して画面を更新すべきとき（ウィザードは開いたまま結果を見せる） */
  onImported: () => void;
}

type Step = 1 | 2 | 3 | 4;

const INPUT =
  "w-full rounded-lg px-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100";
const LABEL = "block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5";
const SELECT =
  "rounded-lg px-2 py-1.5 text-[11px] bg-white border border-gray-200 " +
  "focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";

export function ListImportWizard({ list, onClose, onImported }: ListImportWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── STEP1：ファイル ──
  const [fileName, setFileName] = useState("");
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState<ImportEncoding>("utf-8");
  const [detected, setDetected] = useState<ImportEncoding | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [fileError, setFileError] = useState("");
  const [consentNote, setConsentNote] = useState("");

  // ── STEP2：列の対応づけ・オプション ──
  const [columnMap, setColumnMap] = useState<ColumnMap>([]);
  const [opts, setOpts] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);

  // ── STEP3：検証 ──
  const [rows, setRows] = useState<DupCheckRow[]>([]);
  const [summary, setSummary] = useState<ValidateSummary | null>(null);
  const [validating, setValidating] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<"all" | "insert" | "update" | "skip" | "error">("all");

  // ── STEP4：実行 ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // ── 解析（文字コード・区切りが変わったら作り直す）──
  const text = useMemo(
    () => (fileBytes ? decodeBytes(fileBytes, encoding) : ""),
    [fileBytes, encoding],
  );
  const allRows = useMemo(
    () => (text ? parseCsv(text, delimiter) : []),
    [text, delimiter],
  );
  const header = useMemo<string[]>(
    () => (hasHeader ? allRows[0] ?? [] : (allRows[0] ?? []).map((_, i) => `列${i + 1}`)),
    [allRows, hasHeader],
  );
  const dataRows = useMemo(
    () => (hasHeader ? allRows.slice(1) : allRows),
    [allRows, hasHeader],
  );
  const inputs = useMemo(
    () => rowsToEntryInputs(dataRows, columnMap),
    [dataRows, columnMap],
  );

  // 列数が変わったら自動推定をやり直す
  useEffect(() => {
    if (header.length === 0) { setColumnMap([]); return; }
    setColumnMap(autoMapColumns(header));
  }, [header]);

  const tooManyRows = dataRows.length > IMPORT_MAX_ROWS;

  // ── ファイル選択 ──
  const pickFile = async (f: File) => {
    setFileError("");
    setResult(null);
    setRows([]);
    setSummary(null);

    const lower = f.name.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
      setFileError("Markdown（.md）の取り込みは未対応です。CSVに変換してからお試しください。");
      return;
    }
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt")) {
      setFileError("CSVファイル（.csv）を選んでください。");
      return;
    }
    if (f.size > IMPORT_MAX_BYTES) {
      setFileError(`ファイルが大きすぎます（上限 ${Math.floor(IMPORT_MAX_BYTES / 1024 / 1024)}MB）。分割してお試しください。`);
      return;
    }

    const bytes = new Uint8Array(await f.arrayBuffer());
    const enc = detectEncoding(bytes);
    const decoded = decodeBytes(bytes, enc);
    const dl = detectDelimiter(decoded);
    const parsed = parseCsv(decoded, dl);

    setFileName(f.name);
    setFileBytes(bytes);
    setEncoding(enc);
    setDetected(enc);
    setDelimiter(dl);
    setHasHeader(parsed.length > 0 ? looksLikeHeader(parsed[0]) : true);
  };

  // ── STEP3：検証を走らせる ──
  const runValidate = useCallback(async () => {
    setValidating(true);
    const res = await validateImport(list.id, inputs, opts);
    setRows(res.rows);
    setSummary(res.summary);
    setValidating(false);
  }, [list.id, inputs, opts]);

  const goStep3 = async () => { setStep(3); await runValidate(); };

  // 重複時の動作を変えたら、その場で判定を作り直す（プレビューと実行を食い違わせない）
  useEffect(() => {
    if (step !== 3) return;
    const t = setTimeout(() => { runValidate(); }, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.dupPolicy, opts.skipSuppressed]);

  // ── STEP4：実行 ──
  const execute = async () => {
    if (!summary) return;
    setStep(4);
    setRunning(true);
    abortRef.current = { aborted: false };
    setProgress({ done: 0, total: rows.length });

    const res = await runImport({
      listId: list.id,
      seed: {
        fileName, fileKind: "csv", encoding, delimiter,
        columnMap, header, opts,
      },
      rows,
      dataRows,
      fields: mappedFields(columnMap) as ListField[],
      opts,
      onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      signal: abortRef.current,
    });

    // 取得元・同意メモは、リスト側が空のときだけ記録する（既存の記録を消さない）
    await setListConsentNoteIfEmpty(list.id, consentNote);

    setRunning(false);
    setResult(res);
    onImported();
  };

  // 実行中に閉じられたら中断させる（入った分は残る）
  useEffect(() => () => { abortRef.current.aborted = true; }, []);

  // ── 失敗CSVのダウンロード ──
  const downloadErrorCsv = () => {
    const failed = collectFailedRows(dataRows, rows);
    if (failed.length === 0) return;
    const csv = buildErrorCsv(header, failed);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.csv$/i, "") + "_失敗行.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const shownRows = useMemo(() => {
    const list0 = previewFilter === "all" ? rows : rows.filter((r) => r.verdict === previewFilter);
    return list0.slice(0, IMPORT_PREVIEW_ROWS);
  }, [rows, previewFilter]);

  const canNext1 = fileBytes != null && !fileError && dataRows.length > 0 && !tooManyRows;
  const canNext2 = hasRequiredMapping(columnMap);
  const canExec = summary != null && !validating && !summary.abort && (summary.insert + summary.update) > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[60] p-4"
      onClick={running ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[94dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        {/* ヘッダ */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 bg-[#3f3f46] text-white">
          <Icon name="download" size={15} />
          <span className="text-[13px] font-bold">一括取り込み</span>
          <span className="text-[11px] text-gray-300 truncate">— {list.name}</span>
          {!running && (
            <button onClick={onClose} className="ml-auto text-gray-300 hover:text-white" aria-label="閉じる">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        {/* ステップ表示 */}
        <div className="shrink-0 flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          {([[1, "ファイル"], [2, "列の対応づけ"], [3, "プレビュー・確認"], [4, "結果"]] as const).map(([n, label], i) => (
            <div key={n} className="flex items-center min-w-0">
              {i > 0 && <span className="w-4 sm:w-8 h-px bg-gray-300 mx-1.5 shrink-0" />}
              <span className={`flex items-center gap-1.5 text-[10.5px] font-bold whitespace-nowrap ${
                step === n ? "text-red-700" : step > n ? "text-emerald-600" : "text-gray-400"}`}>
                <span className={`w-[19px] h-[19px] rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  step === n ? "bg-red-600 text-white" : step > n ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-500"}`}>
                  {step > n ? "✓" : n}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {/* ══ STEP 1 ══ */}
          {step === 1 && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />

              <div onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}
                className="border-2 border-dashed border-gray-300 rounded-xl p-7 text-center bg-gray-50 cursor-pointer hover:border-red-300">
                <span className="inline-flex text-gray-400"><Icon name="download" size={26} /></span>
                <p className="text-[12.5px] font-bold text-gray-700 mt-1.5">
                  ここにファイルをドラッグ、またはクリックして選択
                </p>
                <p className="text-[10.5px] text-gray-400 mt-0.5">
                  .csv ／ 1ファイル {Math.floor(IMPORT_MAX_BYTES / 1024 / 1024)}MB・{IMPORT_MAX_ROWS.toLocaleString()}行まで
                  ／ 文字コードは自動判定（UTF-8・UTF-8 BOM・Shift_JIS）
                </p>
              </div>

              {fileError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[11.5px] text-red-700 font-bold">{fileError}</p>
                </div>
              )}

              {fileBytes && !fileError && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200">選択中</span>
                    <b className="font-mono">{fileName}</b>
                    <span className="text-gray-500">
                      {dataRows.length.toLocaleString()}行 ／ {(fileBytes.length / 1024).toFixed(1)}KB
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <span className="text-[10px] text-gray-400">文字コード</span>
                    <select className={SELECT} value={encoding}
                      onChange={(e) => setEncoding(e.target.value as ImportEncoding)}>
                      {(["utf-8", "utf-8-bom", "cp932"] as ImportEncoding[]).map((k) => (
                        <option key={k} value={k}>{ENCODING_LABEL[k]}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-gray-400">区切り</span>
                    <select className={SELECT} value={delimiter}
                      onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
                      {([",", ";", "\t"] as Delimiter[]).map((k) => (
                        <option key={k} value={k}>{DELIMITER_LABEL[k]}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                      1行目はヘッダ
                    </label>
                  </div>

                  {detected && (
                    <p className="text-[10.5px] text-emerald-700 mt-1.5">
                      自動判定：{ENCODING_LABEL[detected]} ／ {DELIMITER_LABEL[delimiter]}区切り
                      {hasHeader ? " ／ 1行目をヘッダとして認識しました" : " ／ 1行目もデータとして扱います"}。
                      違っていれば上で変更してください。
                    </p>
                  )}
                  {encoding === "cp932" && (
                    <p className="text-[10.5px] text-amber-700 mt-1">
                      Excelで保存したCSVはこの形式が多いです。次の画面で氏名が文字化けしていないか確認してください。
                    </p>
                  )}
                  {tooManyRows && (
                    <p className="text-[11px] text-red-700 font-bold mt-1.5">
                      行数が上限（{IMPORT_MAX_ROWS.toLocaleString()}行）を超えています。ファイルを分割してください。
                    </p>
                  )}
                </div>
              )}

              <div className="mt-3">
                <label className={LABEL}>取得元・同意メモ（任意 ／ 特定電子メール法の記録用）</label>
                <input className={INPUT} value={consentNote} onChange={(e) => setConsentNote(e.target.value)}
                  placeholder="2026夏 展示会 ブース掲示の同意文言 v2（2026-07-20〜22 取得）" />
                <p className="text-[10px] text-gray-400 mt-1">
                  リスト設定の「取得元・同意メモ」が空のときは、ここに入れた内容がリストにも記録されます。
                </p>
              </div>
            </>
          )}

          {/* ══ STEP 2 ══ */}
          {step === 2 && (
            <>
              <p className="text-[11.5px] text-gray-500 mb-2">
                CSVのヘッダ名から自動で推定しています。違っていればプルダウンで変更してください。
                <b>「メールアドレス」「電話番号」のどちらかは必ず対応づけが必要です。</b>
              </p>

              <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
                <div className="overflow-auto max-h-[290px]">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="tbl-head">
                        <th className="px-2.5 py-2 text-left font-medium">CSVの列</th>
                        <th className="px-2.5 py-2 text-left font-medium">サンプル（1件目）</th>
                        <th className="px-2.5 py-2 text-left font-medium">取り込み先の項目</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {header.map((h, i) => {
                        const cur = columnMap[i] ?? null;
                        const isKey = cur === "email" || cur === "phone";
                        return (
                          <tr key={i} className={cur == null ? "opacity-60" : ""}>
                            <td className="px-2.5 py-1.5 font-mono">{h || `列${i + 1}`}</td>
                            <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-gray-500 max-w-[170px] truncate">
                              {(dataRows[0]?.[i] ?? "").trim() || "—"}
                            </td>
                            <td className="px-2.5 py-1.5">
                              <select
                                className={`${SELECT} ${isKey ? "border-red-400 bg-red-50 text-red-700 font-bold" : ""}`}
                                value={cur ?? ""}
                                onChange={(e) => {
                                  const val = (e.target.value || null) as ListField | null;
                                  setColumnMap((prev) => {
                                    const next = [...prev];
                                    // 同じ項目を2列に割り当てさせない（先に持っていた列を外す）
                                    if (val != null) {
                                      for (let j = 0; j < next.length; j += 1) if (next[j] === val) next[j] = null;
                                    }
                                    next[i] = val;
                                    return next;
                                  });
                                }}>
                                <option value="">（取り込まない）</option>
                                {LIST_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}{f.required ? "（キー）" : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {!canNext2 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-3">
                  <p className="text-[11.5px] text-red-700 font-bold">
                    「メールアドレス」または「電話番号」を1列以上、対応づけしてください。
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <h4 className="text-[12.5px] font-bold text-gray-700 mb-2">重複したときの動作</h4>
                <div className="flex gap-2 flex-wrap mb-2">
                  {(["skip", "update", "abort"] as DupPolicy[]).map((k) => (
                    <button key={k} onClick={() => setOpts({ ...opts, dupPolicy: k })}
                      className={`text-[11px] px-3 py-1.5 rounded-lg border text-left ${
                        opts.dupPolicy === k
                          ? "border-red-500 bg-red-50 text-red-700 font-bold"
                          : "border-gray-200 bg-white text-gray-600"}`}>
                      {DUP_POLICY_LABEL[k]}{k === "skip" ? "（既定）" : ""}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mb-2">
                  重複の判定は「このリストの中」だけで行います（他のリストは見ません）。
                </p>

                <Toggle on={opts.blankOverwrite} onChange={(v) => setOpts({ ...opts, blankOverwrite: v })}>
                  CSVの空欄で既存の値を上書きする
                  <span className="text-gray-400">（既定＝オフ。オンにすると空欄が既存データを消します）</span>
                </Toggle>
                <Toggle on={opts.skipSuppressed} onChange={(v) => setOpts({ ...opts, skipSuppressed: v })}>
                  配信停止リストに載っているアドレスは取り込まない
                </Toggle>
                <p className="text-[10px] text-gray-400 mt-1">
                  ファイル内で重複している行は、最後の1行だけを採用します。
                </p>
              </div>
            </>
          )}

          {/* ══ STEP 3 ══ */}
          {step === 3 && (
            <>
              <div className="flex gap-2 flex-wrap mb-3">
                <Stat label="総行数" value={summary?.total ?? 0} tone="n" />
                <Stat label="取り込む（新規）" value={summary?.insert ?? 0} tone="g" />
                <Stat label="更新" value={summary?.update ?? 0} tone="b" />
                <Stat label="スキップ" value={summary?.skip ?? 0} tone="y" />
                <Stat label="エラー" value={summary?.error ?? 0} tone="r" />
              </div>

              {validating && (
                <p className="text-[11.5px] text-gray-500 mb-3">
                  重複と配信停止リストを照合しています…（{inputs.length.toLocaleString()}件）
                </p>
              )}

              {!validating && summary && summary.abort && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 mb-3">
                  <p className="text-[12.5px] font-bold text-red-700 mb-0.5">中止の設定になっています</p>
                  <p className="text-[11px] text-red-800">
                    「1件でも重複があれば中止する」を選んでいて、重複またはエラーが見つかりました。
                    取り込みを実行できません。動作を変えるか、CSVを修正してください。
                  </p>
                </div>
              )}

              {!validating && summary && !summary.abort && (summary.error > 0 || summary.skip > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
                  <p className="text-[12.5px] font-bold text-amber-800 mb-0.5">
                    エラー{summary.error}件・スキップ{summary.skip}件があります
                  </p>
                  <p className="text-[11px] text-amber-900">
                    このまま実行すると、エラー行を除いた <b>{(summary.insert + summary.update).toLocaleString()}件</b> が取り込まれます。
                    エラー行は結果画面から「失敗理由付きCSV」でダウンロードできます。
                  </p>
                </div>
              )}

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
                  {([["all", "すべて", summary?.total], ["insert", "新規", summary?.insert],
                     ["update", "更新", summary?.update], ["skip", "スキップ", summary?.skip],
                     ["error", "エラー", summary?.error]] as const).map(([k, label, n]) => (
                    <button key={k} onClick={() => setPreviewFilter(k)}
                      className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${
                        previewFilter === k ? "bg-[#3f3f46] text-white border-[#3f3f46]" : "bg-white text-gray-600 border-gray-200"}`}>
                      {label} {n ?? 0}
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] text-gray-400">先頭{IMPORT_PREVIEW_ROWS}行を表示</span>
                </div>

                <div className="overflow-auto max-h-[260px]">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="tbl-head">
                        {["行", "判定", "メールアドレス", "電話番号", "氏名", "年代", "都道府県", "理由"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {shownRows.length === 0 && (
                        <tr><td colSpan={8} className="px-2 py-6 text-center text-gray-400">該当する行はありません</td></tr>
                      )}
                      {shownRows.map((r) => (
                        <tr key={r.no} className={
                          r.verdict === "error" ? "bg-red-50" : r.verdict === "skip" ? "bg-amber-50" : ""}>
                          <td className="px-2 py-1 text-gray-400 font-mono">{hasHeader ? r.no + 1 : r.no}</td>
                          <td className="px-2 py-1"><Verdict v={r.verdict} /></td>
                          <td className="px-2 py-1 font-mono break-all">{r.input.email || "—"}</td>
                          <td className="px-2 py-1 font-mono whitespace-nowrap">{r.input.phone || "—"}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.input.name || "—"}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.input.ageGroup || "—"}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.input.prefecture || "—"}</td>
                          <td className="px-2 py-1 text-gray-600">{r.reason || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ══ STEP 4 ══ */}
          {step === 4 && (
            <>
              {running && (
                <>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 mb-3">
                    <p className="text-[12.5px] font-bold text-blue-800 mb-0.5">取り込み中です</p>
                    <p className="text-[11px] text-blue-900">
                      このタブを閉じると中断します（それまでに取り込んだ分は残ります）。
                    </p>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden mb-1.5">
                    <div className="h-full bg-red-600 transition-all"
                      style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()} 件
                  </p>
                </>
              )}

              {!running && result && (
                <>
                  {result.errorMessage ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 mb-3">
                      <p className="text-[12.5px] font-bold text-red-700 mb-0.5">取り込み中にエラーが発生しました</p>
                      <p className="text-[11px] text-red-800">{result.errorMessage}</p>
                    </div>
                  ) : result.canceled ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
                      <p className="text-[12.5px] font-bold text-amber-800 mb-0.5">取り込みを中断しました</p>
                      <p className="text-[11px] text-amber-900">
                        中断までに取り込んだ分は残っています。取込履歴から実績を確認できます。
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-3">
                      <p className="text-[12.5px] font-bold text-emerald-700 mb-0.5">取り込みが完了しました</p>
                      <p className="text-[11px] text-emerald-800">
                        リスト「{list.name}」に反映しました。件数は取込履歴タブからも確認できます。
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap mb-3">
                    <Stat label="総行数" value={result.inserted + result.updated + result.skipped + result.failed} tone="n" />
                    <Stat label="新規登録" value={result.inserted} tone="g" />
                    <Stat label="更新" value={result.updated} tone="b" />
                    <Stat label="スキップ" value={result.skipped} tone="y" />
                    <Stat label="失敗" value={result.failed} tone="r" />
                  </div>

                  {result.failed > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={downloadErrorCsv}
                          className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-1.5">
                          <Icon name="download" size={13} />
                          失敗した{result.failed}行をCSVでダウンロード
                        </button>
                        <span className="text-[10.5px] text-gray-500">
                          元の全列＋末尾に「失敗理由」列。修正してそのまま再アップロードできます。
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* フッタ */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          {step > 1 && step < 4 && (
            <button onClick={() => setStep((s) => (s - 1) as Step)}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">戻る</button>
          )}
          <span className="ml-auto text-[10.5px] text-gray-400 mr-1 text-right">
            {step === 1 && (canNext1 ? `${dataRows.length.toLocaleString()}行を読み込みました` : "CSVファイルを選んでください")}
            {step === 2 && (canNext2 ? "対応づけができています" : "メールまたは電話の列を指定してください")}
            {step === 3 && !validating && summary && !summary.abort &&
              `${(summary.insert + summary.update).toLocaleString()}件を取り込みます`}
          </span>

          {step === 1 && (
            <button onClick={() => setStep(2)} disabled={!canNext1}
              className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">次へ</button>
          )}
          {step === 2 && (
            <button onClick={goStep3} disabled={!canNext2}
              className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">次へ</button>
          )}
          {step === 3 && (
            <button onClick={execute} disabled={!canExec}
              className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              {summary ? `${(summary.insert + summary.update).toLocaleString()}件を取り込む` : "取り込む"}
            </button>
          )}
          {step === 4 && (
            <>
              {running ? (
                <button onClick={() => { abortRef.current.aborted = true; }}
                  className="text-sm px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50">中断する</button>
              ) : (
                <button onClick={onClose}
                  className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700">閉じる</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 小物 ──────────────────────────────────────────────────────
function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer">
      <span className={`w-8 h-[18px] rounded-full relative shrink-0 transition-colors ${on ? "bg-emerald-500" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? "left-[16px]" : "left-0.5"}`} />
      </span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="hidden" />
      <span className="text-[11.5px] text-gray-700">{children}</span>
    </label>
  );
}

const TONE: Record<string, string> = {
  n: "text-[#3f3f46]", g: "text-emerald-600", b: "text-blue-700", y: "text-amber-600", r: "text-red-600",
};

function Stat({ label, value, tone }: { label: string; value: number; tone: keyof typeof TONE }) {
  return (
    <div className="flex-1 min-w-[86px] border border-gray-200 rounded-lg px-3 py-2 bg-white">
      <div className={`text-[19px] font-extrabold leading-tight ${TONE[tone]}`}>{value.toLocaleString()}</div>
      <div className="text-[9.5px] font-bold text-gray-400">{label}</div>
    </div>
  );
}

function Verdict({ v }: { v: DupCheckRow["verdict"] }) {
  const map = {
    insert: ["新規", "bg-emerald-50 text-emerald-700 border-emerald-300"],
    update: ["更新", "bg-blue-50 text-blue-700 border-blue-300"],
    skip: ["スキップ", "bg-amber-50 text-amber-700 border-amber-300"],
    error: ["エラー", "bg-red-50 text-red-700 border-red-300"],
  } as const;
  const [label, cls] = map[v];
  return <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 border whitespace-nowrap ${cls}`}>{label}</span>;
}
