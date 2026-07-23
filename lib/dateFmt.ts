// ============================================================
// 日時の表示フォーマット（JST固定）
//
//   DB の timestamptz（created_at / sent_at / submitted_at / updated_at 等）は
//   supabase から「+00:00」などのオフセット付きISOで返る。そのまま slice すると
//   UTC のまま表示され、9時間ずれる（配信日時が 14:41 → 05:41 に見える等）。
//   ここで Asia/Tokyo に変換して表示する。
//
//   ⚠️ オフセットの無い naive な datetime-local 文字列（"YYYY-MM-DDTHH:mm"、
//      お知らせ公開日時・イベント日時・回答期限・決済完了日時など）は、
//      すでに JST の見かけ値なので変換しない（二重変換＝逆ズレを防ぐ）。
//
//   ⚠️ timeZone を明示しているため、サーバー/クライアントどちらで実行しても
//      同じ結果になる（実行環境のTZに依存しない）。
// ============================================================

/** ISO文字列がタイムゾーン指定（Z or ±hh:mm）を持つか＝絶対時刻か */
function hasTz(s: string): boolean {
  return /[zZ]$/.test(s) || /[+-]\d\d:?\d\d$/.test(s);
}

function jstParts(iso: string): { y: string; mo: string; d: string; h: string; mi: string } | null {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(dt);
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute") };
}

/** 「YYYY-MM-DD HH:mm」でJST表示。空なら "—" */
export function fmtJst(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  if (!s) return "—";
  if (hasTz(s)) { const p = jstParts(s); if (p) return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`; }
  return s.replace("T", " ").slice(0, 16);   // naive はそのまま
}

/** 「YYYY-MM-DD」でJST表示（日付のみ）。空なら "" */
export function fmtJstDate(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  if (!s) return "";
  if (hasTz(s)) { const p = jstParts(s); if (p) return `${p.y}-${p.mo}-${p.d}`; }
  return s.slice(0, 10);   // naive はそのまま
}
