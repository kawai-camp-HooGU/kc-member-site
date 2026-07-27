// ============================================================
// LINE名寄せ：照合キーの正規化（純関数・クライアント/サーバー共通）
//   ・メール：trim + 小文字
//   ・電話：数字のみ抽出 → 国内形式へ（+81/81 → 先頭0）
//   ・氏名：空白（全半角）除去 + 全角→半角の簡易統一（照合は候補提示のみ）
// ============================================================

/** メール正規化。空/不正は "" を返す。 */
export function normEmail(v: string | null | undefined): string {
  const s = (v ?? "").trim().toLowerCase();
  return s.includes("@") ? s : "";
}

/**
 * 電話正規化。日本の携帯/固定を想定して先頭0の国内形式に寄せる。
 *   +8190… / 8190…  → 090…
 *   ハイフン・全角・空白は無視。判定不能は "" を返す。
 */
export function normPhone(v: string | null | undefined): string {
  if (!v) return "";
  // 全角数字→半角
  const half = v.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  let digits = half.replace(/[^0-9]/g, "");
  if (digits === "") return "";
  // 国番号81 → 先頭0（+81 の + は上で除去済み）
  if (digits.startsWith("81") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  // 国内番号は10〜11桁。範囲外はそのまま返す（比較は文字列一致）
  return digits;
}

/** 氏名正規化。空白除去＋全角英数記号の簡易半角化。照合は候補提示のみ。 */
export function normName(v: string | null | undefined): string {
  if (!v) return "";
  const half = v.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return half.replace(/[\s　]+/g, "").toLowerCase();
}
