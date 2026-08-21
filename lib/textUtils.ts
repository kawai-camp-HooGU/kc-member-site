// ============================================================
// 本文テキストの共通ユーティリティ
//   進捗メモ・特記事項・資料など、自由入力の本文から URL を拾って
//   「本文中のリンク」として並べるために使う。
//
//   ⚠️ URL の正規表現はこの1箇所に集約する（linkifyText も同じものを使う）。
//      本文内のインラインリンクと、下に並ぶリンクカードで拾う範囲がずれると
//      「本文では色が付いているのにカードに出ない」という食い違いが起きる。
// ============================================================

/**
 * URL の抽出パターン。
 *   日本語の文中に貼られる前提で、閉じ括弧・句読点は URL に含めない。
 *   例：「詳細は https://example.com/a を参照。」→ https://example.com/a
 *   ⚠️ グローバルフラグ付きの正規表現は lastIndex を持つ。
 *      使い回さず、必要な箇所で new RegExp(URL_PATTERN, "g") 相当を作ること。
 */
export const URL_SOURCE = "https?://[^\\s<>\"'）)、。」』】]+";

/** 抽出用（毎回作り直して lastIndex の持ち越しを避ける）*/
const urlRe = (): RegExp => new RegExp(URL_SOURCE, "g");

/** 分割用（linkifyText が本文を URL とそれ以外に切り分けるのに使う）*/
export const urlSplitRe = (): RegExp => new RegExp(`(${URL_SOURCE})`, "g");

/** 単体の文字列が URL かどうか */
export const isUrl = (s: string): boolean => new RegExp(`^${URL_SOURCE}$`).test(s);

/** URL の末尾に残りやすい記号を落とす（"…example.com/a." → "…example.com/a"）*/
const trimTail = (u: string): string => u.replace(/[.,:;!?]+$/, "");

/** 本文から URL を抽出する（出現順・重複は1件にまとめる）。 */
export function extractUrls(text: string | null | undefined): string[] {
  const found = (String(text || "").match(urlRe()) ?? []).map(trimTail).filter(Boolean);
  return [...new Set(found)];
}

/** 複数の本文からまとめて URL を抽出する（先に出てきた順・重複は1件）。 */
export function collectUrls(texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => extractUrls(t)))];
}

/** リンクカードの表示用に URL を分解したもの。 */
export interface UrlParts {
  /** 元の URL（href に使う） */
  url: string;
  /** ホスト名（www. は落とす）。カードの見出しに使う */
  host: string;
  /** スキームを外した「ホスト＋パス」。カードの副見出しに使う */
  label: string;
}

/**
 * 表示用に URL を分解する。
 * ⚠️ 解釈できない文字列でも落とさない（本文の書き間違いで画面が壊れないようにする）。
 */
export function urlParts(url: string): UrlParts {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return { url, host, label: `${host}${u.pathname}${u.search}` };
  } catch {
    return { url, host: url, label: url };
  }
}
