// ============================================================
// メール資格情報の暗号化（AES-256-GCM・サーバー専用）
//
//   IMAP パスワードを DB に平文で置かないための暗号化ヘルパー。
//   鍵はサーバー環境変数 MAIL_SECRET_KEY（32バイト）から取得する。
//     生成例:  openssl rand -base64 32
//     設定例:  MAIL_SECRET_KEY=base64の44文字   （hex 64文字でも可）
//
//   ⚠️ このモジュールは Node ランタイム専用（crypto を使う）。
//   ⚠️ 鍵を変更すると既存の暗号文は復号できなくなる（再登録が必要）。
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;   // GCM 推奨 96bit
const TAG_LEN = 16;  // 認証タグ 128bit

/** MAIL_SECRET_KEY が設定されているか */
export function isSecretKeyConfigured(): boolean {
  return (process.env.MAIL_SECRET_KEY ?? "").trim() !== "";
}

/** 32バイト鍵を取り出す（base64 44文字 or hex 64文字を許容） */
function key(): Buffer {
  const raw = (process.env.MAIL_SECRET_KEY ?? "").trim();
  if (!raw) throw new Error("MAIL_SECRET_KEY が未設定です（openssl rand -base64 32 で生成してください）");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("MAIL_SECRET_KEY は32バイト必要です（base64 44文字 または hex 64文字）");
  }
  return buf;
}

/** 平文 → 暗号文（base64）。iv|tag|ciphertext を連結して格納する。 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** 暗号文（base64）→ 平文。改ざん・鍵不一致は例外になる。 */
export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
