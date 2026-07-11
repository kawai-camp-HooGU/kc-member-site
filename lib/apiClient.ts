// ============================================================
// クライアント → 自前 API Route を呼ぶときの共通 fetch（Phase 0）
//
//   API Route 側は lib/authz.ts で Authorization ヘッダを必須にしたため、
//   クライアントからの呼び出しには必ずアクセストークンを付ける必要がある。
//   付け忘れ（＝401）を防ぐため、ここを唯一の入口にする。
//
//   使い方:
//     const res  = await apiFetch("/api/invite", { method: "POST", body: {...} });
//     const json = await res.json();
// ============================================================
import { supabase } from "./supabase";

interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** オブジェクトを渡すと JSON.stringify される。文字列ならそのまま送る。 */
  body?: unknown;
}

/** アクセストークン付きで自前 API Route を呼ぶ */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  let body: BodyInit | undefined;
  if (init.body != null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else {
      body = JSON.stringify(init.body);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }
  }

  return fetch(path, { ...init, headers, body });
}

/**
 * 送信しっぱなしの通知トリガー用（レスポンスを待たない）。
 * ページ遷移中でも届くよう keepalive を付ける。
 */
export async function apiFire(path: string, payload: unknown): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return; // 未ログインなら何もしない

    void fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* 失敗しても本処理は止めない */ });
  } catch { /* noop */ }
}
