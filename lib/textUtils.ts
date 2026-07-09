// 本文からURLを抽出
export function extractUrls(text: string | null | undefined): string[] {
  return String(text || "").match(/https?:\/\/[^\s]+/g) || [];
}
