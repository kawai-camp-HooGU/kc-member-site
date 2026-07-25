// ============================================================
// LINE Messaging API クライアント（サーバー専用）
//   ・署名検証（Webhookの認可代替）
//   ・送信（Reply / Push）
//   ・プロフィール取得 / コンテンツ（メディア）取得
//   ⚠️ シークレットは環境変数のみ（LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）。
//      このモジュールはサーバー（API Route / cron）からのみ import すること。
// ============================================================
import crypto from "crypto";

const API_BASE = "https://api.line.me/v2/bot";
const DATA_BASE = "https://api-data.line.me/v2/bot";

function channelSecret(): string {
  const s = process.env.LINE_CHANNEL_SECRET;
  if (!s) throw new Error("LINE_CHANNEL_SECRET が未設定です");
  return s;
}
function accessToken(): string {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定です");
  return t;
}

// ── 署名検証 ──────────────────────────────────────────────────
/**
 * Webhookの署名を検証する。
 *   rawBody は JSON.parse する前の「生の文字列」を渡すこと（整形済みだと不一致になる）。
 */
export function verifyLineSignature(rawBody: string, signature: string): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", channelSecret())
    .update(rawBody)
    .digest("base64");
  // タイミング安全比較（長さ不一致は即 false）
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── 送信 ──────────────────────────────────────────────────────
interface LineTextMessage { type: "text"; text: string }

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} が失敗しました (${res.status}) ${detail}`);
  }
}

/** 応答トークンで返信（無料）。トークンは1回きり・短時間で失効するため受信直後に使う。 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  const messages: LineTextMessage[] = [{ type: "text", text }];
  await postJson("/message/reply", { replyToken, messages });
}

/** 個別Push送信（課金対象）。スタッフの手動返信で使う。 */
export async function pushText(toUserId: string, text: string): Promise<void> {
  const messages: LineTextMessage[] = [{ type: "text", text }];
  await postJson("/message/push", { to: toUserId, messages });
}

// ── プロフィール取得 ──────────────────────────────────────────
export interface LineProfile {
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
}

/** 友だちのプロフィール。ブロック済み等では 404 になり得る（呼び出し側で握る）。 */
export async function getProfile(userId: string): Promise<LineProfile> {
  const res = await fetch(`${API_BASE}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) {
    throw new Error(`LINE profile 取得に失敗しました (${res.status})`);
  }
  const j = (await res.json()) as {
    displayName?: string; pictureUrl?: string; statusMessage?: string;
  };
  return {
    displayName: j.displayName ?? "",
    pictureUrl: j.pictureUrl ?? "",
    statusMessage: j.statusMessage ?? "",
  };
}

// ── コンテンツ（メディア）取得 ────────────────────────────────
export interface LineContent {
  bytes: Buffer;
  mime: string;
}

/**
 * 受信メッセージの添付（画像・動画・ファイル等）を取得する。
 * ⚠️ 保存期限があるため、受信後すぐ（cron 短間隔）で退避すること。
 */
export async function getContent(messageId: string): Promise<LineContent> {
  const res = await fetch(`${DATA_BASE}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) {
    throw new Error(`LINE content 取得に失敗しました (${res.status})`);
  }
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, mime };
}
