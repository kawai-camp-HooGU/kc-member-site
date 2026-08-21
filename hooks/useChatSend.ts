"use client";
// ============================================================
// メッセージ送信（楽観更新つき）
//
//   【なぜ要るか】
//     従来は sendMessage() が null を返しても `if (msg)` で握り潰していたため、
//     通信断・RLS拒否・添付の失敗が起きても画面上は何も起きず、
//     利用者は「送れたつもり」で画面を閉じていた。
//
//   【やること】
//     1. 送信を押した瞬間に半透明の吹き出しを出す（負のIDが仮メッセージの目印）
//     2. 成功したら本物に差し替える
//     3. 失敗したらトーストを出し、吹き出しを赤枠のまま残して「再送 / 破棄」を出す
//
//   ⚠️ 失敗した仮メッセージは会話IDごとに保持する。
//      IDの集合だけでは足りない：会話を切り替えると loadMessages() が
//      サーバー取得結果で messages を丸ごと置き換えるため、本体が消えてしまう。
//   ⚠️ リロードでは失われる（localStorage への退避は行わない）。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatAttachment, ChatMessage, ChatSide } from "../lib/models";
import { sendMessage } from "../lib/chat";
import { errMessage } from "../lib/errors";
import { useToast } from "../components/common/ToastProvider";

export interface SendDraft {
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  files: File[];
  replyToId: number | null;
}

interface Local {
  msg: ChatMessage;
  draft: SendDraft;
  failed: boolean;
  /** プレビュー用に作った blob URL（解放するために持つ） */
  blobUrls: string[];
}

export interface ChatSendApi {
  sending: boolean;
  /** サーバー取得分に、送信中・送信失敗の仮メッセージを足して返す */
  withLocal: (conversationId: number | null, messages: ChatMessage[]) => ChatMessage[];
  /** 赤枠にするメッセージID */
  failedIds: Set<number>;
  /** 送信する。成功したら保存されたメッセージ、失敗したら null */
  send: (draft: SendDraft) => Promise<ChatMessage | null>;
  retry: (m: ChatMessage) => void;
  discard: (m: ChatMessage) => void;
}

/** 送信直後に出す仮メッセージを組み立てる（添付はローカルの blob URL で先に見せる） */
function buildOptimistic(tempId: number, draft: SendDraft, blobUrls: string[]): ChatMessage {
  const now = new Date().toISOString();
  const attachments: ChatAttachment[] = draft.files.map((f, i) => ({
    id: tempId - i - 1,
    messageId: tempId,
    fileName: f.name,
    storagePath: blobUrls[i] ?? "",
    thumbPath: null,
    mimeType: f.type || "application/octet-stream",
    sizeBytes: f.size,
    createdAt: now,
  }));
  return {
    id: tempId,
    conversationId: draft.conversationId,
    senderMemberId: draft.senderMemberId,
    side: draft.side,
    body: draft.body,
    createdAt: now,
    attachments,
    origin: draft.side === "staff" ? "staff" : "member",
    replyToId: draft.replyToId,
    links: [],
  };
}

export function useChatSend(onSent?: () => void): ChatSendApi {
  const toast = useToast();
  const [locals, setLocals] = useState<Local[]>([]);
  const [sending, setSending] = useState(false);
  const seq = useRef(0);

  // アンマウント時に blob URL を解放する
  const localsRef = useRef<Local[]>([]);
  useEffect(() => { localsRef.current = locals; }, [locals]);
  useEffect(() => () => {
    localsRef.current.forEach((l) => l.blobUrls.forEach((u) => URL.revokeObjectURL(u)));
  }, []);

  const drop = useCallback((id: number): void => {
    setLocals((prev) => {
      prev.filter((l) => l.msg.id === id).forEach((l) => l.blobUrls.forEach((u) => URL.revokeObjectURL(u)));
      return prev.filter((l) => l.msg.id !== id);
    });
  }, []);

  const run = useCallback(async (draft: SendDraft): Promise<ChatMessage | null> => {
    seq.current -= 1;
    const tempId = seq.current;                       // 負のID＝クライアント側の仮メッセージ
    const blobUrls = draft.files.map((f) => URL.createObjectURL(f));
    const optimistic = buildOptimistic(tempId, draft, blobUrls);

    setLocals((prev) => [...prev, { msg: optimistic, draft, failed: false, blobUrls }]);
    setSending(true);
    // 添付だけが落ちるケース（Storageの設定漏れ等）は、本文が保存されるので
    // 送信自体は成功する。黙って消えないよう、失敗したファイル名を集めて必ず知らせる。
    const attachmentErrors: string[] = [];
    try {
      const msg = await sendMessage({
        conversationId: draft.conversationId,
        senderMemberId: draft.senderMemberId,
        side: draft.side,
        body: draft.body,
        files: draft.files,
        replyToId: draft.replyToId,
        onAttachmentError: (name) => attachmentErrors.push(name),
      });
      if (!msg) throw new Error("送信できませんでした");
      if (attachmentErrors.length > 0) {
        toast.error(
          `添付${attachmentErrors.length}件を保存できませんでした（本文は送信済み）：${attachmentErrors.join("、")}`,
        );
      }
      drop(tempId);
      onSent?.();
      return msg;
    } catch (e: unknown) {
      setLocals((prev) => prev.map((l) => (l.msg.id === tempId ? { ...l, failed: true } : l)));
      toast.error(errMessage(e, "送信できませんでした。通信状況をご確認ください"));
      return null;
    } finally {
      setSending(false);
    }
  }, [drop, onSent, toast]);

  const retry = useCallback((m: ChatMessage): void => {
    const target = localsRef.current.find((l) => l.msg.id === m.id);
    if (!target) return;
    drop(m.id);
    void run(target.draft);
  }, [drop, run]);

  const withLocal = useCallback(
    (conversationId: number | null, messages: ChatMessage[]): ChatMessage[] => {
      if (conversationId == null) return messages;
      const mine = locals.filter((l) => l.draft.conversationId === conversationId);
      return mine.length === 0 ? messages : [...messages, ...mine.map((l) => l.msg)];
    },
    [locals],
  );

  const failedIds = useMemo(
    () => new Set(locals.filter((l) => l.failed).map((l) => l.msg.id)),
    [locals],
  );

  const discard = useCallback((m: ChatMessage): void => drop(m.id), [drop]);

  return { sending, withLocal, failedIds, send: run, retry, discard };
}
