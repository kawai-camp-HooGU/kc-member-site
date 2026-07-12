"use client";
// ============================================================
// 過去のチャット要約（メンバー詳細画面）
//
//   「要約する」を押すと、既存の POST /api/chat/summarize を叩いて
//   事務局とのチャット履歴を AI が時系列で要約する。
//
//   ⚠️ 要約結果は **DB に保存しない**（毎回生成）。
//      履歴として残す運用にする場合は、member_chat_summaries のような
//      テーブルを足して generatedAt とセットで保持すること。
//
//   ⚠️ /api/chat/summarize は requireOps（運営のみ）。
//      この画面自体が /ops 配下なので、middleware でも二重に守られている。
// ============================================================
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/apiClient";
import { countChatMessages } from "../../lib/memberDetail";
import { errMessage } from "../../lib/errors";

interface Props {
  /** 事務局との会話ID（まだ会話が無ければ null） */
  conversationId: number | null;
}

export function ChatSummaryCard({ conversationId }: Props) {
  const [count, setCount]     = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [at, setAt]           = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => {
    if (conversationId == null) { setCount(0); return; }
    countChatMessages(conversationId).then(setCount).catch(() => setCount(null));
  }, [conversationId]);

  const run = async () => {
    if (conversationId == null) return;
    setBusy(true); setErr("");
    try {
      const res = await apiFetch("/api/chat/summarize", {
        method: "POST",
        body: { conversationId },
      });
      const json = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "要約に失敗しました");
      setSummary(json.summary ?? "");
      setAt(new Date().toISOString().replace("T", " ").slice(0, 16));
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const noChat = conversationId == null || count === 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm">過去のチャット要約</span>
        <span className="text-[11px] text-gray-400">AI が事務局とのやりとりを要約（毎回生成・保存しません）</span>
        <div className="flex-1" />
        <button onClick={run} disabled={busy || noChat}
          className="px-3 py-1.5 rounded-lg bg-neutral-800 text-white text-xs font-bold hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
          {busy ? "要約中…" : summary ? "🔄 再要約する" : "✨ 要約する"}
        </button>
      </div>

      <div className="p-4">
        {noChat ? (
          <p className="text-center text-[12.5px] text-gray-400 py-6 border border-dashed border-gray-200 rounded-xl">
            このメンバーとのチャットはまだありません。
          </p>
        ) : busy ? (
          <p className="text-center text-[12.5px] text-gray-400 py-6 border border-dashed border-gray-200 rounded-xl">
            要約中… <span className="text-gray-300">（直近のチャットを読み込んでいます）</span>
          </p>
        ) : err ? (
          <p className="text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">{err}</p>
        ) : summary ? (
          <div className="border border-violet-200 bg-violet-50/60 rounded-xl p-4">
            <div className="text-[12px] font-bold text-violet-700 mb-2">🧠 AI 要約</div>
            <div className="text-[13.5px] leading-7 text-gray-700 whitespace-pre-wrap">{summary}</div>
            <div className="flex gap-4 flex-wrap text-[11px] text-gray-400 mt-3">
              <span>対象：{count ?? "—"} 件のメッセージ</span>
              <span>生成：{at}</span>
            </div>
          </div>
        ) : (
          <p className="text-center text-[12.5px] text-gray-400 py-6 border border-dashed border-gray-200 rounded-xl">
            まだ要約されていません。「要約する」を押すと、チャット履歴（{count ?? "—"} 件）を AI が要約します。
          </p>
        )}
      </div>
    </div>
  );
}
