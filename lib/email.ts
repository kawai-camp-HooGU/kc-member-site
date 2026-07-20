// ============================================================
// メール送信（一斉配信・サーバー専用）
//   SMTP 認証情報は環境変数から取得（NEXT_PUBLIC は付けない）:
//     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME
//   例（Xserver）: SMTP_HOST=sv17060.xserver.jp / SMTP_PORT=465 /
//                  SMTP_USER=support@kawaicamp-portal.com / SMTP_FROM=support@kawaicamp-portal.com
// ============================================================
import nodemailer from "nodemailer";

let cached: nodemailer.Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport(): nodemailer.Transporter {
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT || 465);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465=SSL, それ以外(587)=STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** 差出人名の上書き（フォームの自動返信など）。空なら SMTP_FROM_NAME を使う。 */
  fromName?: string;
}

export async function sendMail({ to, subject, text, html, fromName }: MailInput): Promise<void> {
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  // ⚠️ 差出人アドレスは上書きさせない（SPF/DKIM が崩れて迷惑メール判定される）。表示名だけ変える。
  const name = (fromName ?? "").trim() || process.env.SMTP_FROM_NAME || "KAWAI CAMP 事務局";
  await getTransport().sendMail({
    from: `${name} <${fromAddr}>`,
    to,
    subject,
    text,
    html,
  });
}
