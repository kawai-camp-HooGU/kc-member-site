// ============================================================
// チャット添付ファイル（Supabase Storage）
//   非公開バケット "chat-attachments" を使用。
//   パス: {conversationId}/{messageId}/{timestamp}_{safeName}
//
//   【署名URL】
//     非公開バケットなので <img src> に直接パスは渡せない。
//     ・createSignedUrls（複数形）で1メッセージ分をまとめて発行する
//       （添付ごとに1往復すると、履歴20件で20往復になる）
//     ・発行済みURLはメモリにキャッシュし、失効の5分前になったら取り直す
//       （運営が管理画面を開きっぱなしにすると1時間で画像が全部壊れるため）
//
//   【縮小版】
//     画像は送信時に長辺1600pxの縮小版も作って一緒に上げる（makeThumb）。
//     一覧の表示はこちらを使い、拡大時だけ原本を読む。
//     thumb_path が null の既存データは原本にフォールバックする。
// ============================================================
import { supabase } from "./supabase";

export const CHAT_BUCKET = "chat-attachments";
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20MB
/** 1メッセージあたりの添付上限。無制限だと1回の送信でアップロード待ちが読めなくなる */
export const MAX_ATTACH_COUNT = 10;
/** 縮小版の長辺（px） */
export const THUMB_MAX_EDGE = 1600;
/** 縮小版の JPEG 品質 */
const THUMB_QUALITY = 0.85;
/** 署名URLの有効期間（秒） */
const TTL_SEC = 60 * 60;
/** 残りがこれを切ったら取り直す（ミリ秒） */
const REFRESH_MS = 5 * 60 * 1000;

export interface UploadedAttachment {
  fileName: string;
  storagePath: string;
  /** 縮小版のパス。作れなかった／画像でない場合は null */
  thumbPath: string | null;
  mimeType: string;
  sizeBytes: number;
}

const safeName = (name: string): string =>
  name.replace(/[^\w.\-]+/g, "_").slice(-120);

// ── 署名URL ───────────────────────────────────────────────────
interface CachedUrl { url: string; expiresAt: number; }
const urlCache = new Map<string, CachedUrl>();

/**
 * 複数パスの署名URLをまとめて取得する。
 * 有効期限に余裕のあるものはキャッシュから返し、足りない分だけ1回で発行する。
 */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const p of [...new Set(paths)]) {
    if (!p) continue;
    // 送信中の楽観表示はローカルの blob URL をそのまま使う（Storage には無い）
    if (p.startsWith("blob:") || p.startsWith("data:")) { out.set(p, p); continue; }
    const c = urlCache.get(p);
    if (c && c.expiresAt - now > REFRESH_MS) out.set(p, c.url);
    else need.push(p);
  }
  if (need.length === 0) return out;

  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrls(need, TTL_SEC);
  if (error || !data) return out;

  for (const d of data) {
    if (!d.signedUrl || !d.path) continue;
    urlCache.set(d.path, { url: d.signedUrl, expiresAt: now + TTL_SEC * 1000 });
    out.set(d.path, d.signedUrl);
  }
  return out;
}

/** 非公開バケットの一時ダウンロードURLを発行（1件版・既存の呼び出し互換） */
export async function attachmentUrl(storagePath: string): Promise<string | null> {
  const m = await signedUrls([storagePath]);
  return m.get(storagePath) ?? null;
}

// ── 縮小版の生成 ──────────────────────────────────────────────
/**
 * 画像を長辺 THUMB_MAX_EDGE に収まる JPEG へ縮小する。
 * 縮小の必要が無い／失敗した場合は null を返す（呼び出し側は原本だけを使う）。
 * ⚠️ ブラウザ専用（canvas を使う）。サーバー側からは呼ばないこと。
 */
export async function makeThumb(file: File): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const long = Math.max(bmp.width, bmp.height);
    if (long <= THUMB_MAX_EDGE) { bmp.close(); return null; }  // 小さい画像は原本のまま
    const scale = THUMB_MAX_EDGE / long;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close(); return null; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", THUMB_QUALITY),
    );
  } catch {
    return null;   // 変換できない形式（HEIC等）は縮小版なしで通す
  }
}

// ── アップロード ──────────────────────────────────────────────
/**
 * ファイルをStorageへアップロードし、DB登録用メタを返す。
 * 画像で、かつ縮小版が作れた場合は `_thumb.jpg` も併せて上げる。
 */
export async function uploadAttachment(
  conversationId: number,
  messageId: number,
  file: File,
  withThumb = true,
): Promise<UploadedAttachment> {
  const base = `${conversationId}/${messageId}/${Date.now()}_${safeName(file.name)}`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(base, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;

  let thumbPath: string | null = null;
  if (withThumb) {
    const thumb = await makeThumb(file);
    if (thumb) {
      const tp = `${base}_thumb.jpg`;
      // ⚠️ 縮小版の失敗で送信を止めない。原本は既に上がっている。
      const { error: te } = await supabase.storage.from(CHAT_BUCKET).upload(tp, thumb, {
        cacheControl: "3600", upsert: false, contentType: "image/jpeg",
      });
      if (!te) thumbPath = tp;
    }
  }

  return {
    fileName: file.name,
    storagePath: base,
    thumbPath,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}
