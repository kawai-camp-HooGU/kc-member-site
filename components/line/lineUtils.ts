// ============================================================
// LINE UI 共通ユーティリティ（アバター色・イニシャル・時刻整形・状態ラベル）
// ============================================================
import type { LineFriendStatus } from "../../lib/models";

const AVATAR_COLORS = [
  "#e11d2a", "#2563eb", "#2f9e57", "#8a5300", "#6b7280", "#7c3aed", "#0891b2",
];

/** userId or 名前から安定した色を選ぶ */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? "#6b7280";
}

/** 表示名の先頭1文字（無ければ "?"） */
export function initial(name: string): string {
  const t = (name ?? "").trim();
  return t ? t.charAt(0) : "?";
}

/** ISO → "HH:MM" / 昨日以前は "M/D"。空なら "" */
export function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 日付見出し用 "YYYY/M/D（曜）" */
export function fmtDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${w}）`;
}

export interface StatusStyle { label: string; cls: string }
export function statusStyle(status: LineFriendStatus): StatusStyle {
  switch (status) {
    case "friend":     return { label: "友だち",   cls: "bg-emerald-50 text-emerald-700" };
    case "blocked":    return { label: "ブロック", cls: "bg-gray-100 text-gray-500" };
    case "unfollowed": return { label: "ブロック", cls: "bg-gray-100 text-gray-500" };
    default:           return { label: "―",        cls: "bg-gray-100 text-gray-500" };
  }
}
