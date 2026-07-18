// ============================================================
// 汎用AIチャット（別タブ）の起動・受け渡しヘルパー
//
//   呼び出し元画面 → openAiChat() で別タブを開く（用途 mode ＋ 対象 seed を渡す）
//   別タブ         → readAiChatHandoff() で受け取り、postAiChatResult() で結果を返す
//   呼び出し元      → openAiChat の onApply で結果を受け取り、既存の反映処理へ流す
//
//   ・大きな seed（HTML本文など）はURLに載せず localStorage 経由で1回だけ受け渡す。
//   ・結果は postMessage（同一オリジン＋token 照合）で安全に返す。
// ============================================================
import type { AiFeature } from "./ai/types";

/** チャット画面のヘッダーに出す「呼び出し元画面」 */
export interface AiChatSource {
  screen: string;
  crumbs?: string[];
}

/** 用途ごとの初期データ（HTML本文・添削対象・配信条件など） */
export type AiChatSeed = Record<string, unknown>;

/** 反映時に呼び出し元へ返すペイロード */
export interface AiChatPayload {
  /** テキスト系（③添削の修正後／⑤配信の選択案／②返信の案 など） */
  text?: string;
  /** HTML（④HTML生成） */
  html?: string;
}

interface Handoff {
  mode: AiFeature;
  source: AiChatSource;
  seed: AiChatSeed;
  ts: number;
}

const STORE_KEY = (t: string) => `kawai-aichat:${t}`;
const MSG_TYPE = "kawai-aichat-result";
const CHAT_PATH = "/ops/ai-chat";

export interface OpenAiChatOptions {
  mode: AiFeature;
  source: AiChatSource;
  seed?: AiChatSeed;
  /** 別タブから「反映」されたときに呼ばれる */
  onApply: (payload: AiChatPayload) => void;
}

/**
 * 別タブでAIチャットを開く。返り値は購読解除関数（不要なら無視してよい）。
 */
export function openAiChat(o: OpenAiChatOptions): () => void {
  if (typeof window === "undefined") return () => {};
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const handoff: Handoff = { mode: o.mode, source: o.source, seed: o.seed ?? {}, ts: Date.now() };
  try {
    localStorage.setItem(STORE_KEY(token), JSON.stringify(handoff));
  } catch { /* localStorage 不可でも URL の mode で最低限動く */ }

  const listener = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as { __type?: string; token?: string; payload?: AiChatPayload } | null;
    if (!d || d.__type !== MSG_TYPE || d.token !== token) return;
    o.onApply(d.payload ?? {});
  };
  window.addEventListener("message", listener);
  const cleanup = () => window.removeEventListener("message", listener);

  // noopener は付けない（window.opener を残して postMessage で返すため）
  window.open(`${CHAT_PATH}?mode=${encodeURIComponent(o.mode)}&h=${token}`, "_blank");
  return cleanup;
}

/** 別タブ側：URL と localStorage から受け渡しデータを取り出す（1回で消費） */
export function readAiChatHandoff(): { mode: AiFeature; source: AiChatSource; seed: AiChatSeed; token: string } | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const token = p.get("h");
  const mode = p.get("mode") as AiFeature | null;
  if (!token || !mode) return null;

  let source: AiChatSource = { screen: "—" };
  let seed: AiChatSeed = {};
  try {
    const raw = localStorage.getItem(STORE_KEY(token));
    if (raw) {
      const h = JSON.parse(raw) as Handoff;
      source = h.source ?? source;
      seed = h.seed ?? seed;
    }
    localStorage.removeItem(STORE_KEY(token));
  } catch { /* noop */ }
  return { mode, source, seed, token };
}

/** 別タブ側：呼び出し元へ結果を返す */
export function postAiChatResult(token: string, payload: AiChatPayload): boolean {
  if (typeof window === "undefined") return false;
  const opener = window.opener as Window | null;
  if (!opener) return false;
  opener.postMessage({ __type: MSG_TYPE, token, payload }, window.location.origin);
  return true;
}
