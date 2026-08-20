// ============================================================
// 添付ファイルの種類判定（画像かどうか）
//
//   lib/ に置く理由：会話プレビュー文言を作る lib/chat.ts と、
//   吹き出しを描く components/chat/* の両方から呼ぶため。
//   UI層に置くと lib → components の逆依存になる。
//
//   判定は mime_type を第一とし、空・octet-stream の古い行は拡張子で救う。
//   SVG は <img> で描画するとスクリプトを含みうるため、画像として扱わない
//   （ファイルカードでのダウンロード扱いにする）。
// ============================================================
import type { ChatAttachment } from "./models";

/** インライン表示してよい画像の拡張子（SVG は意図的に除外） */
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

/** ブラウザが表示できない画像形式（アップロードは通すが、サムネイルは出さない） */
const UNRENDERABLE_EXT = ["heic", "heif", "tif", "tiff"];

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/** mime とファイル名から「インライン表示してよい画像か」を判定する */
export function isImageMime(mime: string, fileName: string): boolean {
  const ext = extOf(fileName);
  if (UNRENDERABLE_EXT.includes(ext)) return false;
  const m = (mime ?? "").toLowerCase();
  if (m === "image/svg+xml") return false;
  if (m.startsWith("image/")) return true;
  // mime が空／application/octet-stream の古い行は拡張子で救う
  return IMAGE_EXT.includes(ext);
}

/** 送信済み添付が画像か */
export const isImageAttachment = (a: ChatAttachment): boolean =>
  isImageMime(a.mimeType, a.fileName);

/** 送信前の File が画像か */
export const isImageFile = (f: File): boolean => isImageMime(f.type, f.name);

/** 会話一覧のプレビュー用ラベル（絵文字は使わない） */
export const attachmentLabel = (fileName: string, mime: string): string =>
  `${isImageMime(mime, fileName) ? "画像" : "ファイル"} ／ ${fileName}`;
