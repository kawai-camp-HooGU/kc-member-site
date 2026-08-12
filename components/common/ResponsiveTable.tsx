"use client";
// ============================================================
// ResponsiveTable — 1つの列定義から「PC=表 / スマホ=カード」を自動生成する
//
//   PC(md以上) … 通常の <table>（横に広い場合は親で横スクロール）
//   スマホ(md未満) … 各行を1カードに再構成
//       ・primary 指定の列 … カードの見出し（大きめ）
//       ・secondary(通常) … 「ラベル：値」の行として縦積み
//
//   密度が非常に高い集計表（権限・属性など）は、カード化より
//   「横スクロール＋先頭列 sticky」が向く。その場合は本部品を使わず
//   従来テーブルを overflow-x-auto でラップする方針（設計仕様書 5-3 参照）。
//
//   使い方：
//     <ResponsiveTable
//       rows={members}
//       keyOf={(m) => m.id}
//       onRowClick={(m) => openDetail(m)}
//       cols={[
//         { key: "name", header: "氏名", cell: (m) => m.name, primary: true },
//         { key: "mail", header: "メール", cell: (m) => m.email },
//         { key: "plan", header: "プラン", cell: (m) => m.plan },
//       ]}
//     />
// ============================================================
import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** スマホのカードで見出しにする列（1つ推奨） */
  primary?: boolean;
  /** セルの追加クラス（右寄せ等） */
  className?: string;
  /** スマホのカードでは出さない列（PCのみ表示） */
  hideOnCard?: boolean;
}

export interface ResponsiveTableProps<T> {
  rows: T[];
  cols: Column<T>[];
  keyOf: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** データ0件時の表示 */
  empty?: ReactNode;
  className?: string;
}

export function ResponsiveTable<T>({ rows, cols, keyOf, onRowClick, empty, className }: ResponsiveTableProps<T>) {
  const emptyNode = empty ?? <span className="text-slate-400">データがありません。</span>;

  return (
    <div className={className}>
      {/* ── PC：通常テーブル（md 以上）。広い場合は横スクロール ── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="tbl-head">
              {cols.map((c) => (
                <th key={c.key} className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${c.className ?? ""}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-3 py-6 text-center">{emptyNode}</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={keyOf(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-t border-slate-100 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-middle ${c.className ?? ""}`}>{c.cell(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── スマホ：カード積み（md 未満） ── */}
      <div className="md:hidden space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm">{emptyNode}</div>
        ) : (
          rows.map((row) => {
            const primary = cols.find((c) => c.primary);
            const rest = cols.filter((c) => !c.primary && !c.hideOnCard);
            return (
              <button key={keyOf(row)} type="button"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`w-full text-left rounded-xl border border-slate-200 bg-white p-3 ${onRowClick ? "active:bg-slate-50" : ""}`}>
                {primary && <div className="font-bold text-slate-800 mb-1">{primary.cell(row)}</div>}
                <div className="space-y-1">
                  {rest.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-slate-500 shrink-0">{c.header}</span>
                      <span className={`text-slate-700 text-right min-w-0 ${c.className ?? ""}`}>{c.cell(row)}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
