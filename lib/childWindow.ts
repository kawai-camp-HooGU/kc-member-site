// ============================================================
// 別ウィンドウ（子ウィンドウ）の開閉ヘルパ
//
//   メンバー詳細（/ops/members/[id]）や回答詳細のように、一覧から
//   **別ウィンドウ** で開く画面のための共通処理。
//
//   ⚠️ window.open の第3引数に `noopener` を付けると window.opener が null になり、
//      「閉じたあとに呼び出し元へ戻る（フォーカスする）」ができなくなる。
//      同一オリジンの自前画面なので noopener は付けない。
//      （rel="noopener" は外部サイトを開くときの対策で、ここでは不要）
// ============================================================

/**
 * 子ウィンドウを開く。
 *   name を渡すと同じ名前のウィンドウを使い回す（同じメンバーを二重に開かない）。
 */
export function openChildWindow(url: string, name = "_blank"): Window | null {
  const w = window.open(url, name);
  try { w?.focus(); } catch { /* ポップアップブロック等 */ }
  return w;
}

/**
 * 自ウィンドウを閉じるだけ。呼び出し元へのフォーカスは行わない。
 *   スクリプトで開かれていないタブは window.close() が効かないため、
 *   その場合だけ「戻る」→ fallbackUrl の順にフォールバックする。
 */
export function closeSelf(fallbackUrl = "/ops"): void {
  window.close();
  setTimeout(() => {
    if (window.closed) return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = fallbackUrl;
  }, 120);
}

/**
 * 自ウィンドウを閉じて、呼び出し元ウィンドウへ遷移（フォーカス）する。
 *   opener が取れない（直接URLを叩いた・noopener で開かれた）場合は
 *   closeSelf と同じフォールバックになる。
 */
export function returnToOpener(fallbackUrl = "/ops"): void {
  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    try { opener.focus(); } catch { /* クロスオリジン等 */ }
  }
  closeSelf(fallbackUrl);
}

// ── 呼び出し元への更新通知 ──────────────────────────────────
//
//   子ウィンドウで保存・削除すると、呼び出し元の一覧は古いままになる。
//   （Realtime の members UPDATE は届くが、属性・メモは members 行に無いため
//    mergeMember が旧値を維持する＝属性の変更が一覧に反映されない）
//   そこで閉じる直前に postMessage を投げ、呼び出し元でデータを読み直す。

/** 他サイトからの postMessage を拾わないための識別子 */
const CHANNEL = "kawai-camp";

export type ChildUpdateType = "member-updated" | "member-deleted";

export interface ChildUpdate {
  channel: typeof CHANNEL;
  type: ChildUpdateType;
  /** 対象のID（メンバーIDなど）。呼び出し元が部分更新したい場合に使う */
  id?: number;
}

/** 呼び出し元ウィンドウへ更新を通知する（opener が無ければ何もしない） */
export function notifyOpener(type: ChildUpdateType, id?: number): void {
  const opener = window.opener as Window | null;
  if (!opener || opener.closed) return;
  const msg: ChildUpdate = { channel: CHANNEL, type, id };
  try { opener.postMessage(msg, window.location.origin); } catch { /* クロスオリジン等 */ }
}

/**
 * 子ウィンドウからの更新通知を購読する。戻り値は解除関数。
 *   ⚠️ origin と channel を必ず検証する。message イベントは
 *      任意のサイトから送れるため、素直に信じてはいけない。
 */
export function onChildUpdate(handler: (msg: ChildUpdate) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as Partial<ChildUpdate> | null;
    if (!d || d.channel !== CHANNEL || !d.type) return;
    handler(d as ChildUpdate);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
