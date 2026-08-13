// ============================================================
// メール本文（プレーンテキスト）中の URL をリンク化する。
//   dangerouslySetInnerHTML は使わず、[文字列 | <a>] の React ノード配列を返す。
//   （文字列部分は React が自動エスケープするため XSS 安全）
// ============================================================
import React from "react";

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const TRAIL = /[)\]｝】。、，．！？!?,.;:]+$/; // URL末尾の記号は除外（誤検出防止）

/** テキストを [文字列 | <a>] の配列に変換する。 */
export function linkify(text: string): React.ReactNode[] {
  if (!text) return [text];
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const tail = url.match(TRAIL)?.[0] ?? "";
    if (tail) url = url.slice(0, -tail.length);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
        className="text-blue-600 underline break-all hover:text-blue-800">
        {url}
      </a>,
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
