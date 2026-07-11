// ============================================================
// HTMLサニタイズ（サーバー専用・依存ライブラリなし）
//
//   コンテンツ本文（contents.body_html）は掲載画面で
//   dangerouslySetInnerHTML により描画される。
//   AI生成物・手入力のいずれであっても、ここを必ず通してから
//   クライアントへ返す／DBへ保存する（多層防御の本命）。
//
//   方針: 「除去」ではなく「再構築」。
//   入力をトークン化し、ホワイトリストに載っているタグ・属性だけを
//   組み立て直して出力する。未知のものは出力に現れない。
// ============================================================
import type { HtmlSanitizeInfo } from "./types";

/** 出力を許可するタグ */
export const ALLOWED_TAGS = new Set([
  "h3", "h4", "h5", "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "strong", "b", "em", "i", "u", "br", "hr",
  "a", "img", "blockquote", "div", "span", "small", "code", "pre",
]);

/** 閉じタグを持たないタグ */
const VOID_TAGS = new Set(["br", "hr", "img"]);

/** タグごとに許可する属性 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": new Set(["class", "style"]),
  a: new Set(["href", "target", "rel", "class", "style"]),
  img: new Set(["src", "alt", "width", "height", "class", "style"]),
  td: new Set(["colspan", "rowspan", "class", "style"]),
  th: new Set(["colspan", "rowspan", "scope", "class", "style"]),
};

/** style 属性で許可する宣言（expression/url など危険なものを弾く） */
const STYLE_SAFE = /^[a-z-]+\s*:\s*[^;{}()]*$/i;

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** href/src に使えるスキームか（javascript: / data: を拒否） */
function safeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // 相対パス・アンカーは許可
  if (/^(\/|#|\.\/|\.\.\/)/.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  return null; // javascript:, data:, vbscript:, file: など
}

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

interface Attr { name: string; value: string }

/** タグの属性文字列をパース */
function parseAttrs(src: string): Attr[] {
  const out: Attr[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? "" });
  }
  return out;
}

/**
 * HTML断片をサニタイズして返す。
 * 何を除去したかを info に記録し、UIの「安全チェック」表示に使う。
 */
export function sanitizeHtml(input: string): { html: string; info: HtmlSanitizeInfo } {
  const removedTags = new Set<string>();
  const removedAttrs = new Set<string>();
  const externalLinks = new Set<string>();

  // コメント・CDATA・DOCTYPE は丸ごと落とす
  let src = (input ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");

  // script / style / iframe などは中身ごと落とす（開始〜終了）
  src = src.replace(
    /<\s*(script|style|iframe|object|embed|noscript|template|svg|math|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    (_m, tag: string) => { removedTags.add(String(tag).toLowerCase()); return ""; },
  );

  const out: string[] = [];
  const stack: string[] = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src)) !== null) {
    // タグ前のテキスト
    if (m.index > last) out.push(escapeText(src.slice(last, m.index)));
    last = tagRe.lastIndex;

    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] ?? "";
    const selfClosing = m[4] === "/";

    if (!ALLOWED_TAGS.has(tag)) {
      removedTags.add(tag);
      continue; // タグごと落とす（中身のテキストは残る）
    }

    if (closing) {
      if (VOID_TAGS.has(tag)) continue;
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue; // 対応する開始タグが無い → 捨てる
      // 途中の未閉タグをまとめて閉じる
      for (let k = stack.length - 1; k >= i; k--) out.push(`</${stack[k]}>`);
      stack.length = i;
      continue;
    }

    // 開始タグ：属性をフィルタ
    const allowed = ALLOWED_ATTRS[tag] ?? ALLOWED_ATTRS["*"];
    const parts: string[] = [];
    for (const a of parseAttrs(rawAttrs)) {
      // on* は常に拒否
      if (a.name.startsWith("on") || !allowed.has(a.name)) {
        removedAttrs.add(a.name);
        continue;
      }
      if (a.name === "href" || a.name === "src") {
        const u = safeUrl(a.value);
        if (!u) { removedAttrs.add(`${a.name}(unsafe)`); continue; }
        if (isExternal(u)) externalLinks.add(u);
        parts.push(`${a.name}="${escapeAttr(u)}"`);
        continue;
      }
      if (a.name === "style") {
        const decls = a.value.split(";").map((d) => d.trim()).filter(Boolean).filter((d) => STYLE_SAFE.test(d));
        if (decls.length === 0) { removedAttrs.add("style"); continue; }
        parts.push(`style="${escapeAttr(decls.join("; "))}"`);
        continue;
      }
      parts.push(`${a.name}="${escapeAttr(a.value)}"`);
    }

    // 外部リンクには rel を強制付与（target=_blank の脆弱性対策）
    if (tag === "a" && parts.some((p) => p.startsWith("href="))) {
      if (!parts.some((p) => p.startsWith("rel="))) parts.push('rel="noopener noreferrer"');
    }

    const attrStr = parts.length > 0 ? " " + parts.join(" ") : "";
    if (VOID_TAGS.has(tag) || selfClosing) {
      out.push(`<${tag}${attrStr}>`);
    } else {
      out.push(`<${tag}${attrStr}>`);
      stack.push(tag);
    }
  }
  if (last < src.length) out.push(escapeText(src.slice(last)));

  // 閉じ忘れを補完
  for (let k = stack.length - 1; k >= 0; k--) out.push(`</${stack[k]}>`);

  return {
    html: out.join("").trim(),
    info: {
      removedTags: Array.from(removedTags),
      removedAttrs: Array.from(removedAttrs),
      externalLinks: Array.from(externalLinks),
    },
  };
}

/** AI応答から ```html フェンスや前置きを取り除いて HTML 断片だけにする */
export function stripCodeFence(raw: string): string {
  let s = (raw ?? "").trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  return s.trim();
}
