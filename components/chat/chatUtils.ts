// チャットUI共通ヘルパー
import type { Role } from "../../lib/models";

const PALETTE = ["#e11d2a", "#2563eb", "#2f9e57", "#7c3aed", "#e08a00", "#0ea5a0", "#6b7280"];
export const avatarColor = (id: number): string => PALETTE[Math.abs(id) % PALETTE.length];
export const initial = (name: string): string => (name.trim()[0] ?? "?");

export const fmtTime = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
};
export const fmtDay = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
export const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
export const fmtSize = (b: number): string =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

export const fileExt = (name: string, mime: string): string => {
  const m = name.split(".").pop();
  if (m && m.length <= 4) return m.toUpperCase();
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("pdf")) return "PDF";
  return "FILE";
};

export interface RoleBadge { label: string; cls: string; }
export const roleBadge = (role: Role): RoleBadge => {
  switch (role) {
    case "管理者":       return { label: "管理者", cls: "bg-red-100 text-red-700" };
    case "オペレーター": return { label: "オペレーター", cls: "bg-blue-100 text-blue-700" };
    case "外部":         return { label: "外部", cls: "bg-gray-100 text-gray-600" };
    default:             return { label: "メンバー", cls: "bg-green-100 text-green-700" };
  }
};
