// ============================================================
// 本文HTMLの埋め込みトークン（data-embed）を扱うパーサ（REQ-106）
//
//   運営が本文HTML（contents.body_html）のトップレベルへ
//     <div data-embed="{public_token}"></div>
//   と書くと、描画時にそのコンテンツの動画プレーヤー／資料ビューアが
//   その場に出る。ここは「HTML片」と「参照」へ切り分けるところまでを担う。
//
//   ⚠️ DOMParser を使わないこと。
//      lib/doorPage.ts の resolveDoorHtml() は window.DOMParser が無い SSR で
//      "" を返す設計になっている。本文の描画先である PublicPage / PublicContent は
//      "use client" の無いサーバーコンポーネントなので、同じ作りにすると
//      公開URLで本文が丸ごと消える。だから正規表現走査で実装する。
//
//   ⚠️ 入力は sanitizeHtml() を通ったものであること。
//      ただし「タグの対応が必ず取れている」とまでは仮定しない。
//      サニタイザは <div ... /> のような自己終了タグを VOID と同じ扱いにするため、
//      閉じタグの無い <div> が出力に残りうる（→ isSelfClosed の分岐）。
// ============================================================
import { EMBED_TOKEN_RE } from "./ai/sanitize";

export type BodyPart =
  | { type: "html"; html: string }
  | { type: "embed"; token: string };

/** 閉じタグを持たないタグ（sanitize.ts の VOID_TAGS と揃える） */
const VOID_TAGS = new Set(["br", "hr", "img"]);

const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

/** 開始タグの属性文字列から data-embed の値を取り出す（無ければ null） */
function embedTokenOf(rawAttrs: string): string | null {
  const m = /\bdata-embed\s*=\s*"([^"]*)"/i.exec(rawAttrs)
    ?? /\bdata-embed\s*=\s*'([^']*)'/i.exec(rawAttrs);
  if (!m) return null;
  const v = m[1].trim();
  return EMBED_TOKEN_RE.test(v) ? v : null;
}

/**
 * 本文HTMLに現れる埋め込みトークンを、重複を除いて集める。
 *
 *   深さを問わず拾う（<p> の中など、実際には解決されない位置のものも含む）。
 *   サーバー側の事前取得に使う用途なので、多めに拾っても実害は無い。
 *   逆に取りこぼすと「本文には書いてあるのに出ない」になるため、広めに取る。
 */
export function collectEmbedTokens(html: string | null | undefined): string[] {
  const src = String(html ?? "");
  if (!src.includes("data-embed")) return [];
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG_RE.source, "g");
  while ((m = re.exec(src)) !== null) {
    if (m[1] === "/") continue;                       // 終了タグ
    if (m[2].toLowerCase() !== "div") continue;       // div 以外では許可していない
    const tok = embedTokenOf(m[3] ?? "");
    if (tok) found.add(tok.toLowerCase());
  }
  return [...found];
}

/**
 * 本文HTMLを「HTML片」と「埋め込み参照」へ分割する。
 *
 *   境界にするのは、**トップレベル（深さ0）に単独で置かれた**
 *   <div data-embed="…"></div> だけ。中身は空白・改行のみ可。
 *
 *   切らない場合（＝そのままHTMLとして残す）：
 *     ・<p> や <td>、<details> の内側にあるもの（切ると開始/終了タグが
 *       別の片に分かれて DOM が壊れるため）
 *     ・中身が空でないもの（運営が何か書いている＝意図が読めないため）
 *
 *   該当が1つも無ければ [{ type:"html", html }] を返す。
 *   ＝トークンを使っていない既存の本文は、従来と完全に同じ1枚のHTMLになる。
 */
export function splitEmbedTokens(html: string | null | undefined): BodyPart[] {
  const src = String(html ?? "");
  if (!src || !src.includes("data-embed")) return [{ type: "html", html: src }];

  const parts: BodyPart[] = [];
  let cut = 0;      // まだ parts へ積んでいない先頭位置
  let depth = 0;    // 開いたままのタグの数

  const re = new RegExp(TAG_RE.source, "g");
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] ?? "";
    const selfClosing = m[4] === "/";
    const isVoid = VOID_TAGS.has(tag) || selfClosing;

    if (closing) { if (!VOID_TAGS.has(tag)) depth = Math.max(0, depth - 1); continue; }

    // ── 深さ0の div[data-embed] だけが境界の候補 ──
    if (depth === 0 && tag === "div") {
      const token = embedTokenOf(rawAttrs);
      if (token) {
        const openStart = m.index;
        const openEnd = re.lastIndex;

        if (isVoid) {
          // <div data-embed="…" /> … サニタイザが閉じタグ無しで出力した形。
          //   そのまま残すと以降が全部この div の中に入ってしまうので、
          //   ここで境界として食い切る（結果的に DOM の崩れも直る）。
          if (openStart > cut) parts.push({ type: "html", html: src.slice(cut, openStart) });
          parts.push({ type: "embed", token });
          cut = openEnd;
          continue;
        }

        // 対応する </div> を探す。間に別の div が無いこと＋中身が空白のみを条件にする。
        const close = /<\s*\/\s*div\s*>/gi;
        close.lastIndex = openEnd;
        const cm = close.exec(src);
        if (cm) {
          const inner = src.slice(openEnd, cm.index);
          if (inner.trim() === "" && !/<[a-zA-Z]/.test(inner)) {
            if (openStart > cut) parts.push({ type: "html", html: src.slice(cut, openStart) });
            parts.push({ type: "embed", token });
            cut = close.lastIndex;
            re.lastIndex = close.lastIndex;   // 走査位置を </div> の後ろへ送る
            continue;
          }
        }
        // 条件に合わない＝ただの div として扱う（深さを進める）
      }
    }

    if (!isVoid) depth += 1;
  }

  if (cut < src.length) parts.push({ type: "html", html: src.slice(cut) });
  return parts.length > 0 ? parts : [{ type: "html", html: src }];
}
