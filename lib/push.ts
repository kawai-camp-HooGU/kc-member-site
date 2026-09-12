// ============================================================
// 通知（Web Push）クライアント側
//   - Service Worker 登録／購読・解除
//   - 端末購読情報を push_subscriptions に保存
//   - 通知設定（マスター／トーク／お知らせ）の読み書き
// ============================================================
import { supabase } from "./supabase";
import { apiFetch, apiFire } from "./apiClient";

export interface NotifySettings {
  enabled: boolean;      // マスター
  chatEnabled: boolean;  // トークの受信
  newsEnabled: boolean;  // お知らせの受信
}
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { enabled: true, chatEnabled: true, newsEnabled: true };

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** この環境で Web Push が使えるか */
export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && typeof Notification !== "undefined";
}

/** 現在の通知許可状態: "default" | "granted" | "denied" | "unsupported" */
export function permissionState(): string {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

// VAPID公開鍵（URL-safe base64）→ ArrayBuffer
//   TypeScript 5.7 以降、Uint8Array は Uint8Array<ArrayBufferLike> となり
//   BufferSource（= ArrayBuffer 実体が必要）に代入できないため ArrayBuffer で返す。
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buf;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

/** この端末が購読済みか */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

/** この端末を通知対象に登録（許可リクエスト → 購読 → DB保存） */
export async function subscribeDevice(memberId: number): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "この環境では通知に対応していません" };
  if (!VAPID_PUBLIC) return { ok: false, reason: "VAPID公開鍵が未設定です（NEXT_PUBLIC_VAPID_PUBLIC_KEY）" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "通知が許可されませんでした" };

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "購読情報の取得に失敗しました" };
  }

  const { error } = await supabase.from("push_subscriptions").upsert({
    member_id: memberId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  if (error) { console.error("push_subscriptions upsert:", error); return { ok: false, reason: "購読情報の保存に失敗しました" }; }

  return { ok: true };
}

/** この端末の購読を解除（DBからも削除） */
export async function unsubscribeDevice(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
  } catch (e) { console.error("unsubscribeDevice:", e); }
}

// ── 通知設定 ──
export async function loadNotifySettings(memberId: number): Promise<NotifySettings> {
  const { data, error } = await supabase
    .from("notification_settings").select("*").eq("member_id", memberId).maybeSingle();
  if (error || !data) return { ...DEFAULT_NOTIFY_SETTINGS };
  return {
    enabled: data.enabled ?? true,
    chatEnabled: data.chat_enabled ?? true,
    newsEnabled: data.news_enabled ?? true,
  };
}

export async function saveNotifySettings(memberId: number, s: NotifySettings): Promise<void> {
  const { error } = await supabase.from("notification_settings").upsert({
    member_id: memberId,
    enabled: s.enabled,
    chat_enabled: s.chatEnabled,
    news_enabled: s.newsEnabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: "member_id" });
  if (error) console.error("notification_settings upsert:", error);
}

/**
 * テスト送信（サーバー経由で自分の端末へプッシュ）
 * 送信先はサーバー側でトークン上の本人に固定されるため、memberId は送らない。
 */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch("/api/push/test", { method: "POST", body: {} });
    const json = (await res.json().catch(() => ({}))) as { error?: string; sent?: number };
    if (!res.ok) return { ok: false, error: json.error ?? "送信に失敗しました" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "送信に失敗しました" };
  }
}

/**
 * 通知トリガー（チャット／お知らせ）。失敗しても本処理は止めない。
 * 送信者はサーバー側でトークンから確定されるため、senderMemberId / senderName は送らない。
 */
export function firePushNotify(payload: Record<string, unknown>): void {
  void apiFire("/api/push/notify", payload);
}
