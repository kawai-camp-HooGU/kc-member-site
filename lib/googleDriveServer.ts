// ============================================================
// Googleドライブ／スプレッドシートの読み取り（サーバー専用）
//
//   CS運用の要監視顧客台帳を、エージェントが更新したGoogle側から取り込むために使う。
//   読み取り専用。書き込みは行わない。
//
//   ⚠️ 依存パッケージを増やさない。サービスアカウントのJWTを node:crypto で自作し、
//      あとは fetch で REST を叩く（googleapis は 10MB 超あり、cron 1本のために入れない）。
//   ⚠️ 要監視顧客は個人情報を含むため「リンクを知っている全員」で共有しない。
//      サービスアカウントのメールアドレスへ**閲覧者として個別共有**する。
//   ⚠️ fail-closed。環境変数が欠けていたら「読めた」ではなく必ず例外にする。
// ============================================================
import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** 認証に使う設定。1つでも欠けていたら null（呼び出し元で「未設定」として扱う）。 */
export function googleServiceAccount(): { email: string; key: string } | null {
  const email = (process.env.GOOGLE_SA_EMAIL ?? "").trim();
  // Vercel の環境変数は改行を \n のまま持つので戻す
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!email || !key) return null;
  return { email, key };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** サービスアカウントのJWTを作り、アクセストークンと交換する。 */
export async function googleAccessToken(): Promise<string> {
  const sa = googleServiceAccount();
  if (!sa) throw new Error("GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY が未設定です");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: sa.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(sa.key));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Googleの認証に失敗しました（${res.status}）`);
  const json = await res.json() as { access_token?: string };
  const token = json.access_token;
  if (!token) throw new Error("アクセストークンを取得できませんでした");
  return token;
}

export interface GoogleFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/** ファイルの素性を見る（スプレッドシートかCSVかを判定するため）。 */
export async function googleFileMeta(fileId: string): Promise<GoogleFileMeta> {
  const token = await googleAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
    + `?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new Error("ファイルが見つかりません（IDが違うか、サービスアカウントへ共有されていません）");
  if (!res.ok) throw new Error(`ファイル情報を取得できませんでした（${res.status}）`);
  return await res.json() as GoogleFileMeta;
}

/**
 * ファイルの中身を CSV として読む。
 *
 *   ・Googleスプレッドシート → export でCSVに変換して読む（先頭シートのみ）
 *   ・それ以外（アップロードされたCSVなど） → そのままダウンロードして読む
 */
export async function googleReadCsv(fileId: string): Promise<{ meta: GoogleFileMeta; csv: string }> {
  const meta = await googleFileMeta(fileId);
  const token = await googleAccessToken();
  const isSheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fcsv&supportsAllDrives=true`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`本文を取得できませんでした（${res.status}）`);
  const csv = await res.text();
  return { meta, csv };
}
