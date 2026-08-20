// ============================================================
// メールアドレスの正規化（純関数・依存なし）
//
//   重複判定と配信停止の照合に使う「唯一の正本」。
//   ⚠️ クライアント（画面）とサーバー（送信エンジン）の両方から使うため、
//      supabase など環境に依存するものを import しないこと。
//      ここが分岐すると「画面では停止扱いなのに送信されてしまう」事故になる。
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 重複判定・停止照合に使うメールアドレスの正規化。形式不正は null。
 *
 * ⚠️ ドット除去・`+`タグ除去は gmail.com / googlemail.com のみに限定する。
 *    RFC 5321 では local-part は大文字小文字を区別する仕様であり、
 *    全ドメインで一律にドットを無視すると「別人を同一人物と誤判定」する
 *    （Google Workspace の独自ドメインではドットは無視されない）。
 *    表示用には必ず生の入力値を残すこと。
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!EMAIL_RE.test(v)) return null;
  const at = v.lastIndexOf("@");
  const lp = v.slice(0, at);
  const dom = v.slice(at + 1).toLowerCase();
  if (dom === "gmail.com" || dom === "googlemail.com") {
    const base = lp.toLowerCase().split("+")[0].replace(/\./g, "");
    if (!base) return null;
    return `${base}@gmail.com`;
  }
  return `${lp.toLowerCase()}@${dom}`;
}
