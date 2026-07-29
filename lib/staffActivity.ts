// ============================================================
// スタッフ別 対応ログ 抽出（Staff Activity Log）データアクセス
//   ・明細   … RPC get_staff_activity（4ソースを横断UNION、運営のみ）
//   ・集計   … RPC get_staff_activity_summary（スタッフ×種別の件数）
//   ・候補   … LINE/メールの送信元アカウント一覧（フィルタ用）
//   ・CSV    … 抽出結果を Excel で開ける CSV(UTF-8 BOM) に整形
//
//   ⚠️ 新規テーブル/関数は database.types.ts 未生成のため、RPC呼び出しだけ
//      局所的に any キャストする（.from(...) の型は既存生成物を利用）。
// ============================================================
import { supabase } from "./supabase";

export type ActivityKind = "line" | "mail" | "talk" | "pay";

export const KIND_LABEL: Record<ActivityKind, string> = {
  line: "LINE",
  mail: "メール",
  talk: "トーク",
  pay:  "決済",
};

export const ALL_KINDS: ActivityKind[] = ["line", "mail", "talk", "pay"];

/** 抽出条件（画面のフィルタ状態） */
export interface ActivityFilters {
  from?: string | null;          // ISO（>=）
  to?: string | null;            // ISO（<、終端は翌日0時など呼び出し側で調整）
  staffIds?: number[] | null;    // 空/未指定=全員
  kinds?: ActivityKind[] | null; // 空/未指定=全種別
  accountIds?: number[] | null;  // LINE/メールの送信元アカウント
  includeAuto?: boolean;         // LINE自動送信を含める
  keyword?: string | null;
}

/** 明細1行（RPC get_staff_activity の1行） */
export interface ActivityRow {
  at: string;                    // ISO
  kind: ActivityKind;
  staffId: number | null;
  staffName: string;             // 空/自動送信は "" のことがある
  accountId: number | null;
  accountLabel: string | null;   // LINE公式ID / メールアドレス / 決済サイト名
  counterpart: string;           // 対応相手（会員名 / 宛先 など）
  action: string;                // reply/push/send/create/update/match/delete …
  summary: string;               // 本文・件名・差分など
}

/** 集計1行（スタッフ×種別の件数） */
export interface ActivitySummaryRow {
  staffId: number | null;
  staffName: string;
  kind: ActivityKind;
  cnt: number;
}

/** フィルタ用：送信元アカウント候補 */
export interface AccountOption {
  id: number;
  label: string;
  kind: "line" | "mail";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

function toRpcArgs(f: ActivityFilters) {
  const staff = f.staffIds && f.staffIds.length ? f.staffIds : null;
  const kinds = f.kinds && f.kinds.length ? f.kinds : null;
  const accts = f.accountIds && f.accountIds.length ? f.accountIds : null;
  const kw = (f.keyword ?? "").trim();
  return {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_staff_ids: staff,
    p_kinds: kinds,
    p_account_ids: accts,
    p_include_auto: Boolean(f.includeAuto),
    p_keyword: kw ? kw : null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normRow(r: any): ActivityRow {
  return {
    at: r.at,
    kind: r.kind as ActivityKind,
    staffId: r.staff_id ?? null,
    staffName: r.staff_name ?? "",
    accountId: r.account_id ?? null,
    accountLabel: r.account_label ?? null,
    counterpart: r.counterpart ?? "",
    action: r.action ?? "",
    summary: r.summary ?? "",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 明細を抽出（新しい順） */
export async function fetchStaffActivity(
  f: ActivityFilters,
  limit = 200,
  offset = 0,
): Promise<{ rows: ActivityRow[]; error?: string }> {
  const { data, error } = await rpc("get_staff_activity", {
    ...toRpcArgs(f),
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { rows: [], error: error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data as any[]) ?? []).map(normRow);
  return { rows };
}

/** スタッフ×種別の件数集計 */
export async function fetchStaffActivitySummary(
  f: ActivityFilters,
): Promise<{ rows: ActivitySummaryRow[]; error?: string }> {
  const { data, error } = await rpc("get_staff_activity_summary", toRpcArgs(f));
  if (error) return { rows: [], error: error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data as any[]) ?? []).map((r: any) => ({
    staffId: r.staff_id ?? null,
    staffName: r.staff_name ?? "",
    kind: r.kind as ActivityKind,
    cnt: Number(r.cnt) || 0,
  }));
  return { rows };
}

/** フィルタ用：LINE公式アカウント＋メールアカウントの候補 */
export async function fetchActivityAccounts(): Promise<AccountOption[]> {
  const out: AccountOption[] = [];
  const [{ data: la }, { data: ma }] = await Promise.all([
    supabase.from("line_accounts")
      .select("id, name, basic_id, is_deleted")
      .eq("is_deleted", false)
      .order("sort_order", { ascending: true }),
    supabase.from("mail_accounts")
      .select("id, address, display_name, is_deleted")
      .eq("is_deleted", false)
      .order("sort_order", { ascending: true }),
  ]);
  for (const a of la ?? []) {
    const label = (a.basic_id && a.basic_id.trim()) || a.name || `LINE#${a.id}`;
    out.push({ id: a.id, label, kind: "line" });
  }
  for (const a of ma ?? []) {
    const label = a.address || a.display_name || `Mail#${a.id}`;
    out.push({ id: a.id, label, kind: "mail" });
  }
  return out;
}

// ── CSV 出力 ────────────────────────────────────────────────
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 抽出結果を CSV(UTF-8 BOM) 文字列へ */
export function buildActivityCsv(rows: ActivityRow[]): string {
  const header = ["日時", "種別", "スタッフ", "アカウント", "相手", "操作", "内容"];
  const lines = rows.map((r) =>
    [
      r.at,
      KIND_LABEL[r.kind] ?? r.kind,
      r.staffName || "(自動/不明)",
      r.accountLabel ?? "",
      r.counterpart,
      r.action,
      r.summary,
    ].map(csvCell).join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}

/** CSV をブラウザでダウンロード */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
