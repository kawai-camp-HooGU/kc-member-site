// ============================================================
// 扉ページHTML専用サニタイズ
//
//   セクションの扉ページ（content_sections.door_html）は
//   会員のハブ画面で dangerouslySetInnerHTML により描画される。
//   ここが stored-XSS の唯一の入口なので、保存時・描画時の両方で必ず通す。
//
//   本文（contents.body_html）とはリスク前提が違うため、
//   ホワイトリストを分ける：
//     ・本文  … AI生成・運営入力の混在。見出しは h3 以下に抑え、装飾を最小化
//     ・扉    … 書き手は運営（is_ops）のみ。レイアウト用のタグと
//               data-* トークンを追加で許可する
//
//   ⚠️ 「何を通すか」を広げるだけで、塞ぐ側は一切ゆるめない。
//      script / iframe / form / style タグの除去、on* 属性の拒否、
//      javascript: 等のURLスキーム拒否は sanitizeHtml() の中で
//      プロファイルに関係なく常に適用される。
//
//   ⚠️ <style> タグは許可しない。
//      ページ全体のCSSを上書きできてしまうことに加え、
//      brand.md の「色を一箇所に集約する」に反し、
//      配色変更で全画面を追う状態を生むため。
//      レイアウトは app/globals.css の .door-* プリセットclass で組む。
// ============================================================
import { ALLOWED_TAGS, sanitizeHtml, type SanitizeProfile } from "./sanitize";
import type { HtmlSanitizeInfo } from "./types";

/**
 * 扉ページで使えるトークン属性。
 *   描画時に lib/doorPage.ts の resolveDoorHtml() が実データへ解決する。
 *   ⚠️ 解決後に付与される data-page-id は、あえてここに含めない。
 *      運営が直接書けてしまうと、権限チェックを迂回した遷移先を
 *      仕込めるため（解決器だけが付けられる属性にしておく）。
 */
export const DOOR_TOKEN_ATTRS = [
  "data-page",          // そのページへの入口。権限が無ければ要素ごと除去
  "data-page-cover",    // ページのカバー画像を背景に敷く
  "data-resume",        // 未読が残る先頭ページへ（＝続きから）
  "data-name",          // ページ名に差し替え
  "data-progress",      // 「4 / 10」に差し替え
  "data-progress-bar",  // 進捗バーを挿入
] as const;

/** 扉ページで許可するタグ（本文用＋レイアウト用） */
export const DOOR_ALLOWED_TAGS = new Set<string>([
  ...ALLOWED_TAGS,
  // レイアウト・文書構造
  "h1", "h2", "section", "article", "header", "footer", "nav",
  "figure", "figcaption", "dl", "dt", "dd",
]);

/** 全タグ共通で許可する属性 */
const COMMON_ATTRS = new Set<string>([
  "class", "style", "id", "role", "aria-label", "aria-hidden",
  ...DOOR_TOKEN_ATTRS,
]);

/** タグごとに許可する属性 */
const DOOR_ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": COMMON_ATTRS,
  a: new Set<string>([...COMMON_ATTRS, "href", "target", "rel"]),
  img: new Set<string>([...COMMON_ATTRS, "src", "alt", "width", "height", "loading"]),
  td: new Set<string>([...COMMON_ATTRS, "colspan", "rowspan"]),
  th: new Set<string>([...COMMON_ATTRS, "colspan", "rowspan", "scope"]),
};

export const DOOR_PROFILE: SanitizeProfile = {
  allowedTags: DOOR_ALLOWED_TAGS,
  allowedAttrs: DOOR_ALLOWED_ATTRS,
};

/**
 * 扉ページHTMLの上限（バイト数ではなく文字数）。
 *   22コース分のカードでも約12,000字。余裕を見て64KB相当。
 *   これを超えるものは編集ミス（貼り付け事故）とみなして保存前に弾く。
 */
export const DOOR_HTML_MAX = 65536;

/**
 * 扉ページHTMLをサニタイズして返す。
 * 何を除去したかを info に記録し、運営画面の「安全チェック」表示に使う。
 */
export function sanitizeDoorHtml(input: string | null | undefined): {
  html: string;
  info: HtmlSanitizeInfo;
} {
  return sanitizeHtml(String(input ?? ""), DOOR_PROFILE);
}

/** 除去内容を運営向けの日本語メッセージにする（保存後トーストに使う） */
export function describeDoorSanitize(info: HtmlSanitizeInfo): string[] {
  const msgs: string[] = [];
  for (const t of info.removedTags) {
    if (t === "style") {
      msgs.push("<style> は使えません。.door-* のクラスか style 属性で指定してください");
    } else if (t === "script" || t === "iframe" || t === "object" || t === "embed") {
      msgs.push(`<${t}> は使えません（スクリプト・外部埋め込みは禁止です）`);
    } else if (t === "form") {
      msgs.push("<form> は使えません（会員に偽の入力欄を見せないため）");
    } else {
      msgs.push(`<${t}> は扉ページで使えないタグのため除去しました`);
    }
  }
  for (const a of info.removedAttrs) {
    if (a.startsWith("on")) {
      msgs.push(`${a} は使えません。遷移は data-page を使ってください`);
    } else if (a.endsWith("(unsafe)")) {
      msgs.push(`${a.replace("(unsafe)", "")} に安全でないURLが指定されていたため除去しました`);
    } else {
      msgs.push(`${a} 属性は扉ページで使えないため除去しました`);
    }
  }
  return msgs;
}
