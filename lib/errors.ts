/** catch(e: unknown) からメッセージ文字列を安全に取り出す */
export function errMessage(e: unknown, fallback = "不明なエラー"): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}
