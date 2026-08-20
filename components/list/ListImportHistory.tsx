"use client";
// ============================================================
// リスト管理：右ペイン「取込履歴」タブ
//   一括取り込みの実行結果を一覧する。失敗行は「失敗理由」列付きのCSVで
//   ダウンロードして、修正してそのまま再アップロードできる。
//
//   ⚠️ Mailchimp は結果の閲覧が24時間で切れるが、こちらはジョブ行に
//      残しているので後から追える（設計の意図）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../common/Icon";
import { fmtJst } from "../../lib/dateFmt";
import type { ContactList, ListImportJob } from "../../lib/models";
import {
  fetchImportJobs, fetchImportErrorRows, fetchImportHeader, DUP_POLICY_LABEL,
} from "../../lib/listImportRun";
import { ENCODING_LABEL, buildErrorCsv } from "../../lib/listImportParse";
import type { ImportEncoding } from "../../lib/listImportParse";

export interface ListImportHistoryProps {
  list: ContactList;
  /** 取り込み直後に親から再読込を促すためのキー */
  reloadKey: number;
}

const STATUS: Record<ListImportJob["status"], { label: string; cls: string }> = {
  queued:   { label: "待機中",   cls: "bg-gray-100 text-gray-600 border-gray-200" },
  running:  { label: "実行中",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  done:     { label: "完了",     cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  canceled: { label: "中断",     cls: "bg-amber-50 text-amber-700 border-amber-300" },
  failed:   { label: "失敗",     cls: "bg-red-50 text-red-700 border-red-300" },
};

export function ListImportHistory({ list, reloadKey }: ListImportHistoryProps) {
  const [jobs, setJobs] = useState<ListImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setJobs(await fetchImportJobs(list.id));
    setLoading(false);
  }, [list.id]);

  useEffect(() => { load(); }, [load, reloadKey]);

  /**
   * 失敗行CSVのダウンロード。
   * 元の列構成はジョブ行の column_map に一緒に残してあるので、そこから復元する。
   */
  const download = async (job: ListImportJob) => {
    setBusyId(job.id);
    const [errorRows, headerRow] = await Promise.all([
      fetchImportErrorRows(job.id),
      fetchImportHeader(job.id),
    ]);
    setBusyId(null);
    if (errorRows.length === 0) return;

    const csv = buildErrorCsv(headerRow, errorRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.fileName.replace(/\.csv$/i, "") || "import"}_失敗行.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span className="text-[10.5px] text-gray-500">
          取り込みの実行結果。失敗行は「失敗理由」列付きのCSVでダウンロードして修正・再取込できます。
        </span>
        <button onClick={load}
          className="ml-auto text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
          再読込
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="tbl-head">
              {["実行日時", "ファイル", "文字コード", "重複時", "総行", "新規", "更新", "スキップ", "失敗", "状態", ""].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-gray-400">読み込み中...</td></tr>
            )}
            {!loading && jobs.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-gray-400">
                取り込みの履歴はありません。「一括取り込み」から実行できます。
              </td></tr>
            )}
            {jobs.map((j) => {
              const st = STATUS[j.status];
              return (
                <tr key={j.id} className="hover:bg-gray-50/60">
                  <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{fmtJst(j.startedAt || j.createdAt)}</td>
                  <td className="px-2.5 py-1.5 max-w-[180px] truncate" title={j.fileName}>{j.fileName || "—"}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[10.5px] whitespace-nowrap">
                    {ENCODING_LABEL[j.encoding as ImportEncoding] ?? j.encoding}
                  </td>
                  <td className="px-2.5 py-1.5 text-[10.5px] whitespace-nowrap">{DUP_POLICY_LABEL[j.dupPolicy]}</td>
                  <td className="px-2.5 py-1.5 font-mono">{j.totalRows.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 font-mono text-emerald-700 font-bold">{j.inserted.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 font-mono text-blue-700">{j.updated.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 font-mono text-amber-700">{j.skipped.toLocaleString()}</td>
                  <td className={`px-2.5 py-1.5 font-mono ${j.failed > 0 ? "text-red-600 font-bold" : "text-gray-400"}`}>
                    {j.failed.toLocaleString()}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 border whitespace-nowrap ${st.cls}`}>
                      {st.label}
                    </span>
                    {j.errorMessage && (
                      <span className="block text-[9.5px] text-red-600 mt-0.5 max-w-[150px] truncate" title={j.errorMessage}>
                        {j.errorMessage}
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5">
                    {j.failed > 0 ? (
                      <button onClick={() => download(j)} disabled={busyId === j.id}
                        className="text-[10.5px] font-bold px-2 py-1 rounded-md border border-red-200 text-red-700
                          hover:bg-red-50 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
                        <Icon name="download" size={12} />
                        {busyId === j.id ? "準備中..." : "失敗CSV"}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
