// 一括登録：貼り付け値の正規化・メンバー照合ユーティリティ
import type { Member, Status, Importance } from "./models";

export const BULK_COLS = 9;
export const BULK_INIT_ROWS = 10;

export const normNm = (s: string): string =>
  String(s).trim().toLowerCase().replace(/[\s　]/g, "").replace(/(さん|様)$/, "");
export const bulkTokens = (v: string): string[] =>
  String(v).split(/[,、]/).map((s) => s.trim()).filter(Boolean);

export interface AssigneeResolve { status: "ok" | "none" | "multi"; name?: string; cands?: string[]; }
export interface AssigneeCellStatus { status: "ok" | "none" | "multi"; names?: string[]; cands?: string[]; }

// 1トークン（名前 or コード）をメンバーマスタに照合
export function resolveAssignee(tok: string, members: Member[]): AssigneeResolve {
  const t = normNm(tok);
  if (!t) return { status: "ok" };
  if (/^\d+$/.test(t)) { const m = members.find((x) => String(x.id) === t); return m ? { status: "ok", name: m.name } : { status: "none" }; }
  const active = members.filter((m) => !m.isDeleted);
  const ex = active.filter((x) => normNm(x.name) === t);
  if (ex.length === 1) return { status: "ok", name: ex[0].name };
  if (ex.length > 1) return { status: "multi", cands: ex.map((x) => x.name) };
  const c = active.filter((x) => normNm(x.name).includes(t) || t.includes(normNm(x.name)));
  if (c.length === 1) return { status: "ok", name: c[0].name };
  if (c.length > 1) return { status: "multi", cands: c.map((x) => x.name) };
  return { status: "none" };
}

// セル値（複数可）の総合ステータス。none>multi>ok の優先
export function assigneeStatus(value: string, members: Member[]): AssigneeCellStatus {
  const ts = bulkTokens(value);
  if (!ts.length) return { status: "ok", names: [] };
  const rs = ts.map((t) => resolveAssignee(t, members));
  if (rs.some((r) => r.status === "none")) return { status: "none" };
  if (rs.some((r) => r.status === "multi")) return { status: "multi", cands: rs.flatMap((r) => r.cands || []) };
  return { status: "ok", names: rs.map((r) => r.name).filter((n): n is string => Boolean(n)) };
}

export const bulkStatusVal = (v: string): Status => {
  const t = String(v).trim();
  if (["完了", "completed", "done"].includes(t)) return "completed";
  if (["進行中", "in_progress", "doing"].includes(t)) return "in_progress";
  return "pending";
};
export const bulkImportanceVal = (v: string): Importance => {
  const t = String(v).trim();
  if (["Ⅲ", "3", "III"].includes(t)) return 3;
  if (["Ⅱ", "2", "II"].includes(t)) return 2;
  if (["Ⅰ", "1", "I"].includes(t)) return 1;
  return "none";
};
// 貼り付け値を選択肢の正規ラベルへ正規化（不正値は空欄）
export const STATUS_LABEL = (v: string): string => {
  const t = String(v).trim();
  if (["完了", "completed", "done"].includes(t)) return "完了";
  if (["進行中", "in_progress", "doing"].includes(t)) return "進行中";
  if (["未着手", "pending", "todo"].includes(t)) return "未着手";
  return "";
};
export const IMPORTANCE_LABEL = (v: string): string => {
  const t = String(v).trim();
  if (["Ⅲ", "3", "III"].includes(t)) return "Ⅲ";
  if (["Ⅱ", "2", "II"].includes(t)) return "Ⅱ";
  if (["Ⅰ", "1", "I"].includes(t)) return "Ⅰ";
  return "";
};
export const isValidDate = (s: string): boolean => {
  const t = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
};
export type DateRowStatus = "ok" | "bad" | "warn";
export const dateRowStatus = (sv: string, ev: string): DateRowStatus => {
  const s = String(sv).trim(), e = String(ev).trim();
  if (!s && !e) return "ok";
  if ((s && !isValidDate(s)) || (e && !isValidDate(e))) return "bad";
  if ((s && !e) || (!s && e)) return "warn";
  if (s && e && s > e) return "warn";
  return "ok";
};
