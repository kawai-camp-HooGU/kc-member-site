// 日付ユーティリティ（全ビュー共通）
export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export const addDays = (s: string, d: number): string => {
  const dt = new Date(s);
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

export const fmtDate = (s: string): string => {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// 貼り付けされた日付文字列を YYYY-MM-DD に正規化
// （2026/06/15・2026-6-5・2026.06.15・2026年6月15日 等に対応）
export function parsePastedDate(str: string | null | undefined): string | null {
  const s = (str ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const mo = String(m[2]).padStart(2, "0");
  const d  = String(m[3]).padStart(2, "0");
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  return iso;
}
