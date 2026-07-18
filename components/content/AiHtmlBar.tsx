"use client";
// ============================================================
// ④ コンテンツ本文HTML 生成サポートAI
//   ・自然言語 → HTML / 選択範囲だけの部分修正
//   ・生成結果は即上書きせず、プレビュー確認 →「反映」で確定
//   ・サーバー側サニタイズの結果（除去したタグ・属性）を必ず表示する
// ============================================================
import { useState } from "react";
import { aiHtmlGenerate } from "../../lib/aiClient";
import { openAiChat } from "../../lib/aiChat";
import { errMessage } from "../../lib/errors";
import type { HtmlSanitizeInfo } from "../../lib/ai/types";

export interface AiHtmlBarProps {
  /** 現在の bodyHtml */
  html: string;
  /** textarea の選択範囲（未選択なら null） */
  selection: { start: number; end: number } | null;
  /** 反映（確定） */
  onApply: (nextHtml: string) => void;
  /** 別タブAIチャットのヘッダーに出す呼び出し元画面名（既定: コンテンツ編集） */
  sourceScreen?: string;
}

const QUICK: { label: string; instruction: string }[] = [
  { label: "見出し＋本文", instruction: "見出し(h3/h4)と本文(p)の構成に整えてください。" },
  { label: "箇条書きに変換", instruction: "内容を箇条書き(ul/li)に変換してください。" },
  { label: "表を作る", instruction: "内容を表(table)に整理してください。" },
  { label: "CTAボタン", instruction: "申し込みへ誘導するリンクボタン（a要素・Tailwindのクラス）を末尾に追加してください。URLは [要確認] のままで構いません。" },
  { label: "既存を整形", instruction: "既存のHTMLの意味を変えずに、見出しレベルとclassを整えて読みやすく整形してください。" },
];

export function AiHtmlBar({ html, selection, onApply, sourceScreen = "コンテンツ編集" }: AiHtmlBarProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ next: string; fragment: string; info: HtmlSanitizeInfo } | null>(null);

  const hasSel = selection != null && selection.end > selection.start;

  const run = async (inst: string) => {
    const text = inst.trim();
    if (!text || busy) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const res = await aiHtmlGenerate({
        instruction: text,
        currentHtml: html,
        selection: hasSel ? selection : null,
      });
      // 部分修正なら選択範囲を置換、そうでなければ全文置き換え
      const next = res.replaceRange
        ? html.slice(0, res.replaceRange.start) + res.html + html.slice(res.replaceRange.end)
        : res.html;
      setResult({ next, fragment: res.html, info: res.sanitized });
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    onApply(result.next);
    setResult(null);
    setInstruction("");
  };

  const removed = result ? result.info.removedTags.length + result.info.removedAttrs.length : 0;

  const launchChat = () => openAiChat({
    mode: "html_generate",
    source: { screen: sourceScreen },
    seed: { html, selection },
    onApply: (p) => { if (typeof p.html === "string") onApply(p.html); },
  });

  return (
    <div className="border border-red-200 bg-red-50 rounded-xl p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-extrabold text-red-700">✦ AIでHTMLを生成 / 修正</span>
        <span className="ml-auto text-[10px] text-gray-500">
          {hasSel ? `選択範囲：${selection!.start}〜${selection!.end}文字目を修正` : "未選択：全体が対象"}
        </span>
      </div>

      {/* 広い専用画面で対話したいとき：別タブのAIチャットを開く（結果はこの本文へ反映）*/}
      <button onClick={launchChat}
        className="w-full mb-2 flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-red-700">
        AIチャットで生成・修正 <span className="text-[10px] opacity-85">↗ 別タブ</span>
      </button>

      <div className="flex gap-2 mb-2">
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(instruction); } }}
          placeholder="例：料金表を3行の表にして。1泊2日 12,000円 / 2泊3日 22,000円"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:border-red-400" />
        <button onClick={() => run(instruction)} disabled={busy || !instruction.trim()}
          className="px-4 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40 shrink-0">
          {busy ? "生成中…" : "生成"}
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="text-[10px] text-gray-500 font-bold">クイック:</span>
        {QUICK.map((q) => (
          <button key={q.label} onClick={() => { setInstruction(q.instruction); run(q.instruction); }} disabled={busy}
            className="text-[10.5px] px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-red-300 disabled:opacity-40">
            {q.label}
          </button>
        ))}
      </div>

      {err && <div className="mt-2 text-[11px] text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {result && (
        <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
            <b className="text-[11px]">生成結果</b>
            <span className="text-[10px] text-gray-400">反映するまで本文は変わりません</span>
          </div>

          {/* 安全チェック（サニタイズ結果） */}
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <div className="text-[10px] font-bold text-gray-600 mb-1">安全チェック（サーバー側サニタイズ済み）</div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {removed === 0 ? (
                <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-bold">✓ 危険なタグ・属性なし</span>
              ) : (
                <>
                  {result.info.removedTags.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                      除去したタグ: {result.info.removedTags.join(", ")}
                    </span>
                  )}
                  {result.info.removedAttrs.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                      除去した属性: {result.info.removedAttrs.join(", ")}
                    </span>
                  )}
                </>
              )}
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                外部リンク {result.info.externalLinks.length}件
              </span>
            </div>
          </div>

          {/* コード */}
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed bg-gray-900 text-gray-100 max-h-[160px] overflow-auto whitespace-pre-wrap break-all">
            {result.fragment}
          </pre>

          {/* プレビュー */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="text-[10px] text-gray-400 font-bold mb-1.5">プレビュー（掲載時の見え方）</div>
            <div className="border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 max-h-[200px] overflow-auto">
              <div className="text-[13.5px] leading-7 text-gray-700 bg-white border border-gray-200 rounded-lg p-3 content-rich"
                dangerouslySetInnerHTML={{ __html: result.fragment }} />
            </div>
          </div>

          <div className="flex gap-2 px-3 py-2 border-t border-gray-100">
            <button onClick={() => setResult(null)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-bold hover:bg-gray-50">破棄</button>
            <button onClick={apply}
              className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700">この生成結果を反映</button>
          </div>
        </div>
      )}
    </div>
  );
}
