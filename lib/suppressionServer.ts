// ============================================================
// 配信停止（unsubscribe / suppression）サーバー専用
//   - 停止アドレスの照合（送信エンジンから bulk 読み込み）
//   - 停止登録（公開リンク /api/unsubscribe から service role で追記）
//   - トークン署名/検証（改ざん防止。メールに載せる停止リンク用）
//   - 停止リンクのフッター文面と List-Unsubscribe URL の生成
// ============================================================
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";

const norm = (e: string) => e.trim().toLowerCase();

// 署名鍵：専用envがあれば使用、無ければ既存のサーバー専用シークレットにフォールバック。
function secret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "kawai-camp-unsub"
  );
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** メールアドレスの停止トークン（HMAC）。リンク改ざん防止用。 */
export function signEmail(email: string): string {
  return createHmac("sha256", secret()).update(norm(email)).digest("base64url");
}

/** トークン検証（timing-safe）。 */
export function verifyEmail(email: string, sig: string): boolean {
  const expected = signEmail(email);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 配信停止リンク（メール本文・List-Unsubscribe に載せる URL）。 */
export function unsubscribeUrl(siteUrl: string, email: string): string {
  const base = (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  return `${base}/api/unsubscribe?e=${b64url(norm(email))}&s=${signEmail(email)}`;
}

/** リンクの e / s パラメータからメールを復元・検証する。無効なら null。 */
export function resolveUnsubscribe(e: string | null, s: string | null): string | null {
  if (!e || !s) return null;
  let email = "";
  try { email = norm(unb64url(e)); } catch { return null; }
  if (!email || !verifyEmail(email, s)) return null;
  return email;
}

/** 送信時に照合する停止アドレス集合（小文字）。エンジンから1回だけ読む想定。 */
export async function loadSuppressedSet(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("email_suppressions").select("email");
  return new Set((data ?? []).map((r) => norm(r.email)));
}

/** 停止登録（重複は無視）。理由は任意。 */
export async function addSuppression(email: string, reason = "本人が停止"): Promise<void> {
  const e = norm(email);
  if (!e) return;
  await supabaseAdmin
    .from("email_suppressions")
    .upsert({ email: e, reason }, { onConflict: "email", ignoreDuplicates: true });
}

/** 本文末尾に付ける配信停止フッター（text / html）と List-Unsubscribe 用 URL。 */
export function buildUnsubscribe(email: string, siteUrl: string): {
  url: string; footerText: string; footerHtml: string;
} {
  const url = unsubscribeUrl(siteUrl, email);
  const footerText = `\n\n――――――――――\n配信停止をご希望の場合はこちら：\n${url}`;
  const footerHtml =
    `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #eee;color:#8a8a92;font-size:12px">` +
    `今後の配信を希望されない場合は <a href="${url}" style="color:#8a8a92">こちら（配信停止）</a> からお手続きください。</div>`;
  return { url, footerText, footerHtml };
}
