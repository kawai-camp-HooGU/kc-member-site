// ============================================================
// 本文リッチテキストの安全描画ヘルパー（クライアント/サーバー共用）
//
//   お知らせ・コンテンツ本文は dangerouslySetInnerHTML で描画される。
//   ここを必ず通すことで stored-XSS を防ぐ。
//   - テキストモード: エスケープしてから URL リンク化・改行 <br> 化
//   - HTMLモード     : 既存の sanitizeHtml（ホワイトリスト再構築）を通す
// ============================================================
import { sanitizeHtml } from "./ai/sanitize";

/** テキストノード用エスケープ */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 属性値用エスケープ */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** href に使える安全なスキームか（javascript: / data: 等を拒否） */
function safeHref(url: string): string | null {
  const v = String(url ?? "").trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  return null;
}

/**
 * プレーンテキストを安全にリンク化して HTML 文字列にする。
 * 生テキストを URL 境界で分割 → 非URL部はエスケープ、URL部は安全な <a> に。
 * （先に全体をエスケープすると URL 内の & が壊れるため、分割を先に行う）
 */
export function linkifySafe(text: string | null | undefined): string {
  const src = String(text ?? "");
  return src
    .split(/(https?:\/\/[^\s<]+)/g)
    .map((part) => {
      const href = safeHref(part);
      if (href) {
        return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part)}</a>`;
      }
      return escapeHtml(part).replace(/\n/g, "<br>");
    })
    .join("");
}

export type BodyMode = "text" | "html";

/**
 * 本文（テキスト/HTML 両モード）を安全な HTML 文字列にして返す。
 * dangerouslySetInnerHTML にはこの戻り値のみを渡すこと。
 */
export function renderBodyHtml(
  mode: BodyMode | string | null | undefined,
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined,
): string {
  if (mode === "html") {
    return sanitizeHtml(String(bodyHtml ?? "")).html;
  }
  return linkifySafe(bodyText);
}

/**
 * 保存時に HTML 本文を正規化（サニタイズ）して返す。
 * DB に汚れた HTML を残さないための多層防御。
 */
export function sanitizeBodyHtml(bodyHtml: string | null | undefined): string {
  return sanitizeHtml(String(bodyHtml ?? "")).html;
}
