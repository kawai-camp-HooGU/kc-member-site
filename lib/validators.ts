// ============================================================
// 入力バリデーション（全フォーム共通）
// ============================================================

/** メールアドレス形式（簡易・実用的） */
export function isValidEmail(s: string | null | undefined): boolean {
  const v = (s ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * 電話番号形式（日本の固定/携帯/フリーダイヤル＋国際番号を許容）。
 * 使える文字は 数字・ハイフン・+・( )・スペース のみ。数字は 10〜15 桁。
 */
export function isValidPhone(s: string | null | undefined): boolean {
  const v = (s ?? "").trim();
  if (!v) return true; // 未入力は許容（任意項目）
  if (!/^[0-9+\-() 　]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/** http(s) の有効な URL か */
export function isValidUrl(s: string | null | undefined): boolean {
  const v = (s ?? "").trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 開始日 ≦ 期限日 ≦ クローズ日 の前後関係チェック。
 * 問題があればエラーメッセージ、なければ null を返す。
 * 空欄はスキップ（任意項目のため）。
 */
export function dateOrderError(
  startDate?: string | null,
  dueDate?: string | null,
  closeDate?: string | null,
): string | null {
  const s = startDate || "";
  const d = dueDate || "";
  const c = closeDate || "";
  if (s && d && s > d) return "期限日は開始日以降にしてください";
  if (d && c && d > c) return "クローズ日は期限日以降にしてください";
  if (s && c && s > c) return "クローズ日は開始日以降にしてください";
  return null;
}
