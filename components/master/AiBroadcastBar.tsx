"use client";
// ============================================================
// ⑤ 配信原稿生成サポートAI（一斉配信 / シナリオ配信）
//   ・目的 / トーン / 長さ / 絵文字 ＋「伝えたいこと」から3案生成
//   ・配信先の属性内訳をAIに渡し、「宛先と文面の齟齬」を warnings で返す
//   ・AIは送信しない。選んだ案が messageBody に入るだけ。
// ============================================================
import { useState } from "react";
import { aiBroadcastDraft, aiBroadcastCheck } from "../../lib/aiClient";
import { openAiChat } from "../../lib/aiChat";
import { errMessage } from "../../lib/errors";
import {
  BC_PURPOSE_LABEL, BC_TONE_LABEL, BC_LENGTH_LABEL, BC_EMOJI_LABEL,
} from "../../lib/ai/types";
import type {
  BcDraft, BcEmoji, BcLength, BcPurpose, BcTarget, BcTone, BcWarning,
} from "../../lib/ai/types";

export interface AiBroadcastBarProps {
  target: BcTarget;
  /** 現在の本文（配信前チェック用） */
  messageBody: string;
  /** 案を本文へ反映 */
  onApply: (text: string) => void;
}

const KEYS = <T extends string>(o: Record<T, string>) => Object.keys(o) as T[];
const sel = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11.5px] bg-white";

export function AiBroadcastBar({ target, messageBody, onApply }: AiBroadcastBarProps) {
  const [purpose, setPurpose] = useState<BcPurpose>("announce");
  const [tone, setTone] = useState<BcTone>("friendly");
  const [length, setLength] = useState<BcLength>("standard");
  const [emoji, setEmoji] = useState<BcEmoji>("few");
  const [points, setPoints] = useState("");
  const [useVariables, setUseVariables] = useState(true);
  const [useAudience, setUseAudience] = useState(true);

  const [drafts, setDrafts] = useState<BcDraft[]>([]);
  const [active, setActive] = useState(0);
  const [warnings, setWarnings] = useState<BcWarning[]>([]);
  const [checks, setChecks] = useState<BcWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");

  const generate = async () => {
    if (!points.trim() || busy) return;
    setBusy(true); setErr(""); setDrafts([]); setWarnings([]);
    try {
      const res = await aiBroadcastDraft({
        purpose, tone, length, emoji, points, target, useVariables, useAudience,
      });
      setDrafts(res.drafts);
      setWarnings(res.warnings);
      setActive(0);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!messageBody.trim() || checking) return;
    setChecking(true); setErr(""); setChecks([]);
    try {
      const res = await aiBroadcastCheck({ messageBody, target });
      setChecks(res.checks);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const mark = (lv: BcWarning["level"]) =>
    lv === "warn" ? { icon: "!", cls: "text-amber-600" }
      : lv === "ok" ? { icon: "✓", cls: "text-green-600" }
        : { icon: "·", cls: "text-gray-400" };

  const launchChat = () => openAiChat({
    mode: "broadcast_draft",
    source: { screen: "一斉配信" },
    seed: { target, points, messageBody },
    onApply: (p) => { if (typeof p.text === "string") onApply(p.text); },
  });

  return (
    <div className="space-y-3">
      {/* 生成フォーム */}
      <div className="border border-red-200 bg-red-50 rounded-xl p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[11px] font-extrabold text-red-700">✦ AIで配信原稿を生成</span>
        </div>
        <button onClick={launchChat}
          className="w-full mb-3 flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-red-700">
          AIチャットで原稿を作る <span className="text-[10px] opacity-85">↗ 別タブ</span>
        </button>

        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">目的</label>
            <select className={sel} value={purpose} onChange={(e) => setPurpose(e.target.value as BcPurpose)}>
              {KEYS(BC_PURPOSE_LABEL).map((k) => <option key={k} value={k}>{BC_PURPOSE_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">トーン</label>
            <select className={sel} value={tone} onChange={(e) => setTone(e.target.value as BcTone)}>
              {KEYS(BC_TONE_LABEL).map((k) => <option key={k} value={k}>{BC_TONE_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">長さ</label>
            <select className={sel} value={length} onChange={(e) => setLength(e.target.value as BcLength)}>
              {KEYS(BC_LENGTH_LABEL).map((k) => <option key={k} value={k}>{BC_LENGTH_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">絵文字</label>
            <select className={sel} value={emoji} onChange={(e) => setEmoji(e.target.value as BcEmoji)}>
              {KEYS(BC_EMOJI_LABEL).map((k) => <option key={k} value={k}>{BC_EMOJI_LABEL[k]}</option>)}
            </select>
          </div>
        </div>

        <label className="text-[10px] font-bold text-gray-500 block mb-1">
          伝えたいこと <span className="text-gray-400 font-normal">箇条書きでOK。ここに書いた事実だけで原稿を作ります</span>
        </label>
        <textarea rows={4} value={points} onChange={(e) => setPoints(e.target.value)}
          placeholder={"・8/12-13 の夏キャンプ、早割が7/31まで\n・1泊2日 11,000円（通常12,000円）\n・申込は専用フォームから"}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[11.5px] bg-white resize-none focus:outline-none focus:border-red-400" />

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-[10.5px] text-gray-600">
            <input type="checkbox" className="accent-red-600" checked={useVariables}
              onChange={(e) => setUseVariables(e.target.checked)} />
            差し込み変数を活用
          </label>
          <label className="flex items-center gap-1.5 text-[10.5px] text-gray-600">
            <input type="checkbox" className="accent-red-600" checked={useAudience}
              onChange={(e) => setUseAudience(e.target.checked)} />
            配信先の属性を反映
          </label>
          <button onClick={generate} disabled={busy || !points.trim()}
            className="ml-auto px-4 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40">
            {busy ? "生成中…" : "3案を生成"}
          </button>
        </div>

        {err && <div className="mt-2 text-[11px] text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{err}</div>}
      </div>

      {/* 生成案 */}
      {drafts.length > 0 && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 flex-wrap">
            {drafts.map((d, i) => (
              <button key={d.label} onClick={() => setActive(i)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${i === active ? "bg-red-600 text-white" : "border border-gray-200 text-gray-500"}`}>
                {d.label}・{d.approach}
              </button>
            ))}
            <button onClick={generate} disabled={busy}
              className="ml-auto px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[11px] font-bold disabled:opacity-40">
              ↻ 再生成
            </button>
          </div>

          <div className="px-3 py-2.5">
            <div className="border border-gray-200 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words bg-gray-50 max-h-[220px] overflow-auto">
              {drafts[active]?.text}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-gray-400">{drafts[active]?.text.length ?? 0}字</span>
              <button onClick={() => onApply(drafts[active]?.text ?? "")}
                className="ml-auto px-4 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700">
                ▸ この案を本文に反映
              </button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 bg-amber-50/50 space-y-1">
              {warnings.map((w, i) => {
                const m = mark(w.level);
                return (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className={`font-bold shrink-0 ${m.cls}`}>{m.icon}</span>
                    <span className="text-gray-600">{w.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 配信前チェック */}
      <div className="border border-gray-200 rounded-xl bg-white">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
          <b className="text-[11.5px]">✦ 配信前チェック</b>
          <span className="text-[10px] text-gray-400">変数の記法・宛先と文面の齟齬を確認</span>
          <button onClick={runCheck} disabled={checking || !messageBody.trim()}
            className="ml-auto px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 text-[10.5px] font-bold hover:bg-gray-50 disabled:opacity-40">
            {checking ? "確認中…" : "チェックする"}
          </button>
        </div>
        <div className="px-3 py-2.5 space-y-1.5">
          {checks.length === 0 && (
            <p className="text-[11px] text-gray-400">本文を書いてから「チェックする」を押してください。</p>
          )}
          {checks.map((c, i) => {
            const m = mark(c.level);
            return (
              <div key={i} className="flex items-start gap-1.5 text-[11.5px]">
                <span className={`font-bold shrink-0 ${m.cls}`}>{m.icon}</span>
                <span className="text-gray-600">{c.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
