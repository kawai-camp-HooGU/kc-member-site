"use client";
// LINEトーク向け AIサポート（右カラム・Phase 3）。
//   返信案の生成／壁打ち（改訂）→「入力欄へ反映」。AIは送信APIを呼ばない（出口は入力欄のみ）。
import { useEffect, useState } from "react";
import { aiLineReplySuggest } from "../../lib/aiClient";
import { errMessage } from "../../lib/errors";
import type { AiDraft, AiTone, AiLength } from "../../lib/ai/types";

export interface LineAiPanelProps {
  friendId: number | null;
  onAdopt: (text: string) => void;
}

const TONES: { v: AiTone; l: string }[] = [
  { v: "standard", l: "標準" }, { v: "polite", l: "丁寧" }, { v: "casual", l: "カジュアル" },
];
const LENGTHS: { v: AiLength; l: string }[] = [
  { v: "standard", l: "標準" }, { v: "short", l: "短く" }, { v: "long", l: "詳しく" },
];
const QUICK = ["もっと短く", "もっと丁寧に", "代替日を提案して", "謝罪を厚めに"];

export function LineAiPanel({ friendId, onAdopt }: LineAiPanelProps) {
  const [tone, setTone] = useState<AiTone>("standard");
  const [length, setLength] = useState<AiLength>("standard");
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [talk, setTalk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chat, setChat] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  // 友だちを切り替えたら案・履歴をリセット
  useEffect(() => { setDrafts([]); setTalk(""); setErr(""); setHistory([]); }, [friendId]);

  const generate = async () => {
    if (friendId == null) return;
    setBusy(true); setErr("");
    try {
      const r = await aiLineReplySuggest({ friendId, action: "generate", tone, length, count: 3 });
      setDrafts(r.drafts);
      setTalk(r.talk);
    } catch (e) { setErr(errMessage(e)); }
    setBusy(false);
  };

  const consult = async (msg: string) => {
    if (friendId == null || !msg.trim()) return;
    setBusy(true); setErr("");
    const nextHist = [...history, { role: "user" as const, content: msg }];
    try {
      const r = await aiLineReplySuggest({ friendId, action: "chat", tone, length, message: msg, history });
      setDrafts((prev) => [...r.drafts, ...prev]);
      if (r.talk) setTalk(r.talk);
      setHistory([...nextHist, { role: "assistant", content: r.talk || "改訂案を作成しました。" }]);
      setChat("");
    } catch (e) { setErr(errMessage(e)); }
    setBusy(false);
  };

  return (
    <div className="w-full h-full flex flex-col bg-white border-l border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 bg-[#fdf4f4]">
        <h2 className="text-[13.5px] font-extrabold flex items-center gap-2">
          ✦ AIサポート <span className="text-[9.5px] font-bold bg-red-600 text-white rounded-full px-2 py-0.5">BETA</span>
        </h2>
        <p className="text-[11px] text-gray-500 mt-0.5">直近のトーク・会員情報・ブックマークを参照して返信案を作成します（送信は人が行います）。</p>
      </div>

      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex gap-1.5 mb-2 text-[11px]">
          <select value={tone} onChange={(e) => setTone(e.target.value as AiTone)} className="flex-1 border border-gray-200 rounded-md px-2 py-1 bg-gray-50">
            {TONES.map((t) => <option key={t.v} value={t.v}>トーン：{t.l}</option>)}
          </select>
          <select value={length} onChange={(e) => setLength(e.target.value as AiLength)} className="flex-1 border border-gray-200 rounded-md px-2 py-1 bg-gray-50">
            {LENGTHS.map((l) => <option key={l.v} value={l.v}>長さ：{l.l}</option>)}
          </select>
        </div>
        <button
          onClick={generate}
          disabled={busy || friendId == null}
          className="w-full bg-red-600 text-white font-bold text-[13px] rounded-lg py-2 disabled:opacity-50"
        >
          {busy ? "生成中…" : "✦ 提案メッセージを生成"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {err && <div className="text-[12px] text-red-600 mb-2">{err}</div>}
        {talk && (
          <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap">{talk}</div>
        )}
        {drafts.length === 0 && !busy && (
          <div className="text-[12px] text-gray-400 text-center py-6">「提案メッセージを生成」で返信案を作成します。</div>
        )}
        {drafts.map((d, i) => (
          <div key={i} className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
              <b className="text-[12px]">{d.label}</b>
              <span className="text-[10.5px] text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">{d.tone}</span>
              {d.needsInput && <span className="text-[10px] text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">要確認あり</span>}
            </div>
            <div className="px-3 py-2 text-[12.5px] whitespace-pre-wrap">{d.text}</div>
            {d.basis && d.basis.length > 0 && (
              <div className="px-3 pb-1.5 flex flex-wrap gap-1">
                {d.basis.map((b, j) => <span key={j} className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">{b}</span>)}
              </div>
            )}
            <div className="px-3 pb-2.5">
              <button onClick={() => onAdopt(d.text)} className="text-[12px] font-bold bg-emerald-500 text-white rounded-md px-3 py-1.5">▸ 入力欄へ反映</button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5">
        <div className="flex flex-wrap gap-1 mb-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => consult(q)} disabled={busy || friendId == null} className="text-[10.5px] text-gray-600 border border-gray-200 rounded-full px-2 py-0.5 disabled:opacity-50">{q}</button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="AIに相談（例：締切を強調して）"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] resize-none min-h-[38px] max-h-[80px] bg-gray-50"
          />
          <button onClick={() => consult(chat)} disabled={busy || !chat.trim() || friendId == null} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50">送信</button>
        </div>
      </div>
    </div>
  );
}
