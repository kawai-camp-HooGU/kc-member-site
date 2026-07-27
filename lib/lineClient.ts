// ============================================================
// LINE Messaging API クライアント（サーバー専用）
//   ・署名検証（Webhookの認可代替）
//   ・送信（Reply / Push）
//   ・プロフィール取得 / コンテンツ（メディア）取得 / ボット情報（接続テスト）
//
//   ⚠️ 複数アカウント対応：シークレット/アクセストークンは引数で受け取る。
//      （呼び出し側が lib/lineAccountsServer.ts で復号して渡す）
//   ⚠️ このモジュールはサーバー（API Route / cron）からのみ import すること。
// ============================================================
import crypto from "crypto";

const API_BASE = "https://api.line.me/v2/bot";
const DATA_BASE = "https://api-data.line.me/v2/bot";

// ── 署名検証 ──────────────────────────────────────────────────
/**
 * Webhookの署名を検証する。
 *   rawBody は JSON.parse する前の「生の文字列」を渡すこと（整形済みだと不一致になる）。
 *   channelSecret は対象アカウントのチャネルシークレット（復号済み）。
 */
export function verifyLineSignature(rawBody: string, signature: string, channelSecret: string): boolean {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── 送信 ──────────────────────────────────────────────────────
interface LineTextMessage { type: "text"; text: string }

async function postJson(accessToken: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} が失敗しました (${res.status}) ${detail}`);
  }
}

/** 応答トークンで返信（無料）。トークンは1回きり・短時間で失効するため受信直後に使う。 */
export async function replyText(accessToken: string, replyToken: string, text: string): Promise<void> {
  const messages: LineTextMessage[] = [{ type: "text", text }];
  await postJson(accessToken, "/message/reply", { replyToken, messages });
}

/** 個別Push送信（課金対象）。スタッフの手動返信で使う。 */
export async function pushText(accessToken: string, toUserId: string, text: string): Promise<void> {
  const messages: LineTextMessage[] = [{ type: "text", text }];
  await postJson(accessToken, "/message/push", { to: toUserId, messages });
}

/** 画像を送信（Push・課金対象）。URLは公開HTTPS・JPEG/PNG。 */
export async function pushImage(
  accessToken: string, toUserId: string, originalContentUrl: string, previewImageUrl: string
): Promise<void> {
  await postJson(accessToken, "/message/push", {
    to: toUserId,
    messages: [{ type: "image", originalContentUrl, previewImageUrl }],
  });
}

/** 動画を送信（Push・課金対象）。プレビュー画像URL（JPEG/PNG）が必須。 */
export async function pushVideo(
  accessToken: string, toUserId: string, originalContentUrl: string, previewImageUrl: string
): Promise<void> {
  await postJson(accessToken, "/message/push", {
    to: toUserId,
    messages: [{ type: "video", originalContentUrl, previewImageUrl }],
  });
}

// ── プロフィール取得 ──────────────────────────────────────────
export interface LineProfile {
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
}

/** 友だちのプロフィール。ブロック済み等では 404 になり得る（呼び出し側で握る）。 */
export async function getProfile(accessToken: string, userId: string): Promise<LineProfile> {
  const res = await fetch(`${API_BASE}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE profile 取得に失敗しました (${res.status})`);
  const j = (await res.json()) as { displayName?: string; pictureUrl?: string; statusMessage?: string };
  return {
    displayName: j.displayName ?? "",
    pictureUrl: j.pictureUrl ?? "",
    statusMessage: j.statusMessage ?? "",
  };
}

// ── ボット情報（接続テスト）───────────────────────────────────
export interface LineBotInfo {
  userId: string;       // ボットのuserId（＝Webhookの destination）
  basicId: string;      // @〜
  displayName: string;
  premiumId: string;
}

/** アクセストークンの正当性＋アカウント特定に使う。接続テストの中核。 */
export async function getBotInfo(accessToken: string): Promise<LineBotInfo> {
  const res = await fetch(`${API_BASE}/info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE bot info 取得に失敗しました (${res.status}) ${detail}`);
  }
  const j = (await res.json()) as {
    userId?: string; basicId?: string; displayName?: string; premiumId?: string;
  };
  return {
    userId: j.userId ?? "",
    basicId: j.basicId ?? "",
    displayName: j.displayName ?? "",
    premiumId: j.premiumId ?? "",
  };
}

// ── Webhookエンドポイント検証（LINE→自サーバの疎通確認）──────
export interface WebhookTestResult { ok: boolean; statusCode: number; reason: string }

/** 登録済みWebhookURLへLINEがテスト送信し、結果を返す。 */
export async function testWebhookEndpoint(accessToken: string): Promise<WebhookTestResult> {
  const res = await fetch(`${API_BASE}/channel/webhook/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, statusCode: res.status, reason: detail || "Webhook設定を確認してください" };
  }
  const j = (await res.json()) as { success?: boolean; statusCode?: number; reason?: string };
  return { ok: j.success === true, statusCode: j.statusCode ?? 0, reason: j.reason ?? "" };
}

// ── コンテンツ（メディア）取得 ────────────────────────────────
export interface LineContent { bytes: Buffer; mime: string }

/**
 * 受信メッセージの添付（画像・動画・ファイル等）を取得する。
 * ⚠️ 保存期限があるため、受信後すぐ（cron 短間隔）で退避すること。
 */
export async function getContent(accessToken: string, messageId: string): Promise<LineContent> {
  const res = await fetch(`${DATA_BASE}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE content 取得に失敗しました (${res.status})`);
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, mime };
}
