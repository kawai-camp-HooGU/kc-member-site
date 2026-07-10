// ============================================================
// チャット添付ファイル（Supabase Storage）
//   非公開バケット "chat-attachments" を使用。
//   パス: {conversationId}/{messageId}/{timestamp}_{safeName}
// ============================================================
import { supabase } from "./supabase";

export const CHAT_BUCKET = "chat-attachments";
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20MB

export interface UploadedAttachment {
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

const safeName = (name: string): string =>
  name.replace(/[^\w.\-]+/g, "_").slice(-120);

/** ファイルをStorageへアップロードし、DB登録用メタを返す */
export async function uploadAttachment(
  conversationId: number,
  messageId: number,
  file: File
): Promise<UploadedAttachment> {
  const path = `${conversationId}/${messageId}/${Date.now()}_${safeName(file.name)}`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return {
    fileName: file.name,
    storagePath: path,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

/** 非公開バケットの一時ダウンロードURLを発行 */
export async function attachmentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
