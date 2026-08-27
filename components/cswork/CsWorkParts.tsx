"use client";
// ============================================================
// CsWork：4メニュー共通のUI部品（REQ-039）
//
//   運用ドキュメント／起草と整形／実行／成果と課題で使い回す。
//   配色・角丸・空状態の作法は brand.md に従う。
//     ・赤はアクセント。危険色として使わない
//     ・空状態は枠を残して「次の1手」を必ず置く
//     ・絵文字を使わない
//
//   ⚠️ Html は **サーバー側でエスケープ済み** の文字列だけを受ける
//      （lib/csWork/parse.ts の escapeHtml を通したもの）。
// ============================================================
import type { ReactNode } from "react";
import type { CsIssueLevel, CsRunner } from "../../lib/csWork/spec";

export function Html({ html }: { html: string }) {
  // サーバー側でエスケープ済みのHTML（lib/csWork/parse.ts）。
  return <div className="cw-body text-[12.5px] leading-7" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Toggle({ title, children, sub, badge, badgeCls, step, count, defaultOpen, query }: {
  title: string; children: ReactNode; sub?: boolean; badge?: ReactNode; badgeCls?: string;
  step?: number; count?: string; defaultOpen?: boolean; query?: string;
}) {
  const hit = !!query?.trim() && title.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <details open={defaultOpen || hit} className={`${sub ? "bg-gray-50 border-gray-200 my-2" : "bg-white border-gray-200 mb-2"} border rounded-xl overflow-hidden`}>
      <summary className={`flex items-center gap-2 cursor-pointer flex-wrap ${sub ? "px-3 py-2 text-[12.5px] font-bold text-red-700" : "px-4 py-3 text-[13px] font-bold text-gray-700"}`}>
        {step != null && <span className="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">STEP {step}</span>}
        <span>{title}</span>
        {badge != null && (typeof badge === "string"
          ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeCls ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>{badge}</span>
          : badge)}
        {count && <span className="ml-auto text-[11px] font-normal text-gray-400">{count}</span>}
      </summary>
      <div className={`${sub ? "px-3 pb-3 bg-white" : "px-4 pb-4"} border-t border-gray-200 pt-3`}>{children}</div>
    </details>
  );
}

export function Chip({ children, cls }: { children: ReactNode; cls: string }) {
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{children}</span>;
}

export const funnelCls = (name: string) =>
  name === "個別面談" ? "bg-red-50 text-red-700 border-red-200"
  : name === "未購入者ウェビナー" ? "bg-blue-50 text-blue-700 border-blue-200"
  : name === "資料請求" ? "bg-amber-50 text-amber-700 border-amber-200"
  : "bg-gray-100 text-gray-500 border-gray-200";

export const staleCls = (level: string) =>
  level === "最優先" ? "bg-red-600 text-white border-red-700"
  : level === "要フォロー" ? "bg-amber-50 text-amber-700 border-amber-200"
  : level === "対象外" ? "bg-gray-100 text-gray-500 border-gray-200"
  : level === "要確認" ? "bg-purple-50 text-purple-700 border-purple-200"
  : "bg-emerald-50 text-emerald-700 border-emerald-200";

/** 実行者バッジ。human は赤（人の担当）、agent は無彩色（機械の担当）で分ける。 */
export const runnerCls = (runner: CsRunner | string) =>
  runner === "human" ? "bg-red-50 text-red-700 border-red-200"
  : runner === "portal-cron" ? "bg-blue-50 text-blue-700 border-blue-200"
  : "bg-gray-100 text-gray-500 border-gray-200";

export const runnerLabel = (runner: CsRunner | string) =>
  runner === "human" ? "人が実施" : runner === "portal-cron" ? "cron" : "エージェント";

export const levelCls = (level: CsIssueLevel | string) =>
  level === "blocker" ? "bg-red-50 text-red-700 border-red-200"
  : level === "warn" ? "bg-amber-50 text-amber-700 border-amber-200"
  : "bg-blue-50 text-blue-700 border-blue-200";

export const levelLabel = (level: CsIssueLevel | string) =>
  level === "blocker" ? "実行不可" : level === "warn" ? "要確認" : "情報";

export const runStatusCls = (status: string) =>
  status === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
  : status === "partial" ? "bg-amber-50 text-amber-700 border-amber-200"
  : status === "failed" ? "bg-red-50 text-red-700 border-red-200"
  : "bg-gray-100 text-gray-500 border-gray-200";

export const runStatusLabel = (status: string) =>
  status === "success" ? "すべて完了"
  : status === "partial" ? "一部が未取得"
  : status === "failed" ? "失敗"
  : "実行されていません";

/**
 * 空状態。brand.md §4 の3型に沿う。
 *   kind="done"    … 対応が0件＝達成（緑・肯定文。灰色で沈めない）
 *   kind="setup"   … 前提が未設定（何が足りないかを述べ、設定画面への導線を置く）
 *   kind="none"    … 期間内に該当なし
 */
export function EmptyBox({ kind, title, hint, actionLabel, onAction }: {
  kind: "done" | "setup" | "none";
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tone = kind === "done"
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : kind === "setup"
      ? "bg-white border-dashed border-gray-300 text-gray-600"
      : "bg-white border-gray-200 text-gray-500";

  return (
    <div className={`border rounded-xl px-6 py-10 text-center ${tone}`}>
      {kind === "done" && (
        <svg viewBox="0 0 24 24" className="w-6 h-6 mx-auto mb-2 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="text-sm font-bold">{title}</div>
      {hint && <div className="text-[12px] mt-1 opacity-80">{hint}</div>}
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-4 bg-red-600 text-white font-bold text-[12.5px] rounded-lg px-5 py-2">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** 部分失敗の赤帯。取得できた分は消さずに、上に1本だけ出す（brand.md §4）。 */
export function PartialBar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-[12px] mb-3">
      {children}
    </div>
  );
}

/** 値の位置に「…」を出す。レイアウトを先に確定させ、値が入っても行がずれないようにする。 */
export function Loading({ label = "読み込み中" }: { label?: string }) {
  return <div className="text-center text-sm text-gray-400 py-16">{label}…</div>;
}

/**
 * テキストをファイルとして保存する。
 *   ⚠️ CSV は BOM を付ける（付けないと Excel が UTF-8 と判断せず文字化けする）。
 */
export function saveTextFile(filename: string, content: string) {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const type = isCsv ? "text/csv;charset=utf-8"
    : filename.toLowerCase().endsWith(".json") ? "application/json;charset=utf-8"
    : "text/markdown;charset=utf-8";
  const blob = new Blob([isCsv ? "﻿" + content : content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
