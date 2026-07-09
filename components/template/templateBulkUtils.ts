export const TBULK_COLS = 8;
export const TBULK_INIT_ROWS = 10;

export const tImpVal = (v: string): string => {
  const s = String(v ?? "").trim();
  if (["3", "Ⅲ", "III", "高"].includes(s)) return "3";
  if (["2", "Ⅱ", "II", "中"].includes(s)) return "2";
  if (["1", "Ⅰ", "I", "低"].includes(s)) return "1";
  return "none";
};
export const TIMP_LABEL = (v: string): string => {
  const k = tImpVal(v);
  return k === "none" ? "" : k === "1" ? "Ⅰ" : k === "2" ? "Ⅱ" : "Ⅲ";
};
export const isBlankNum = (v: string | number): boolean => String(v ?? "").trim() === "";
const isIntStr = (v: string | number): boolean => /^\d+$/.test(String(v ?? "").trim());

export type OffsetRowStatus = "ok" | "bad" | "warn";
export const offsetRowStatus = (sv: string, ev: string): OffsetRowStatus => {
  const s = String(sv ?? "").trim(), e = String(ev ?? "").trim();
  if ((s && !isIntStr(s)) || (e && !isIntStr(e))) return "bad";
  if (s && e && Number(s) > Number(e)) return "warn";
  return "ok";
};
