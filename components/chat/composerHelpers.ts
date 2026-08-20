// 入力欄（Composer）まわりの小道具
export { MAX_ATTACH_BYTES, MAX_ATTACH_COUNT } from "../../lib/chatStorage";
export { isImageFile } from "../../lib/attachments";
import { fmtSize } from "./chatUtils";

export const fmtSizeGuard = (b: number): string => fmtSize(b);

/** 「Enterで送信」の個人設定（既定は false ＝ ⌘/Ctrl+Enter のみ） */
export const SEND_ON_ENTER_KEY = "kawai.chat.sendOnEnter";

export function loadSendOnEnter(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(SEND_ON_ENTER_KEY) === "1"; } catch { return false; }
}

export function saveSendOnEnter(on: boolean): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SEND_ON_ENTER_KEY, on ? "1" : "0"); } catch { /* プライベートモード等は黙って無視 */ }
}

const p2 = (n: number): string => `0${n}`.slice(-2);

/**
 * 貼り付けた画像の名前を作る。
 *   クリップボード由来のファイルは名前が "image.png" 固定で、
 *   後から一覧で見分けられないため、貼付時刻を入れて付け直す。
 */
export function pastedFileName(mime: string, existing: string[]): string {
  const d = new Date();
  const ext = (mime.split("/")[1] ?? "png").replace("jpeg", "jpg").split("+")[0];
  const base = `スクリーンショット_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  let name = `${base}.${ext}`;
  let i = 2;
  while (existing.includes(name)) { name = `${base}_${i}.${ext}`; i += 1; }
  return name;
}
