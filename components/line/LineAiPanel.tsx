"use client";
// LINEトーク向け AIサポート（右カラム・Phase 3）。
//   返信案の生成／壁打ち（改訂）→「入力欄へ反映」。AIは送信APIを呼ばない（出口は入力欄のみ）。
import { useEffect, useState } from "react";
import { aiLineReplySuggest } from "../../lib/aiClient";
import { errMessage } from "../../lib/errors";
import { useConfirm } from "../common/ConfirmProvider";
import { AI_VIEWS, AI_VIEW_LABEL } from "../../lib/ai/types";
import type { AiDraft, AiTone, AiLength, AiView } from "../../lib/ai/types";

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
  // ★ 視点（事務局／ホルダー）。切り替えたら生成済みの案は消す（混在させない）。
  const [view, setView] = useState<AiView>("support");
  const confirm = useConfirm();
  const [tone, setTone] = useState<AiTone>("standard");
  const [length, setLength] = useState<AiLength>("standard");
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [talk, setTalk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chat, setChat] = useState("");

  // ⚠️ A-3：相談履歴はクライアントで持たない。サーバー（ai_consult_sessions）が保持する。
  //    端末に持たせて送り返すと、そこから何でもプロンプトへ差し込めてしまう。

  // 友だちを切り替えたら表示をリセット（サーバーのセッションは相手ごとに分かれている）
  useEffect(() => { setDrafts([]); setTalk(""); setErr(""); }, [friendId]);

  const switchView = async (v: AiView) => {
    if (v === view || busy) return;
    if (drafts.length > 0 || talk) {
      const ok = await confirm({
        title: "視点を切り替える",
        message: `${AI_VIEW_LABEL[v]}視点に切り替えます。視点の違う案が混ざらないよう、生成済みの案を消します。`,
        confirmLabel: "切り替える",
      });
      if (!ok) return;
      setDrafts([]); setTalk("");
    }
    setView(v);
  };

  const generate = async () => {
    if (friendId == null) return;
    setBusy(true); setErr("");
    try {
      const r = await aiLineReplySuggest({ friendId, action: "generate", tone, length, view, count: 3 });
      setDrafts(r.drafts);
      setTalk(r.talk);
    } catch (e) { setErr(errMessage(e)); }
    setBusy(false);
  };

  const consult = async (msg: string) => {
    if (friendId == null || !msg.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await aiLineReplySuggest({ friendId, action: "chat", tone, length, view, message: msg });
      setDrafts((prev) => [...r.drafts, ...prev]);
      if (r.talk) setTalk(r.talk);
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
        {/* ★ 視点は生成前に決める。AIには推測させない。 */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[10px] font-bold text-gray-500 shrink-0">視点</span>
          <div className="flex border border-gray-200 rounded-md overflow-hidden">
            {AI_VIEWS.map((v) => (
              <button key={v.v} onClick={() => void switchView(v.v)} disabled={busy} title={v.hint}
                className={`px-2.5 py-1 text-[10.5px] font-bold disabled:opacity-40 ${
                  view === v.v ? "bg-red-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                }`}>
                {v.l}
              </button>
            ))}
          </div>
          <span className="text-[9.5px] text-gray-400 truncate">
            {AI_VIEWS.find((v) => v.v === view)?.hint}
          </span>
        </div>

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
