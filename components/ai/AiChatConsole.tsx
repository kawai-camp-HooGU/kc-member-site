"use client";
// ============================================================
// 汎用AIチャット（別タブ）
//   用途は呼び出し元で固定。ヘッダーに呼び出し元画面を表示。
//   結果は postMessage で呼び出し元へ「反映」する（送信・保存は呼び出し元で人が行う）。
//
//   対応用途（初期）：④HTML生成 / ③添削 / ⑤配信原稿
//   ・各用途は既存の /api/ai/* をそのまま呼ぶ。
// ============================================================
import { useEffect, useRef, useState } from "react";
import { aiHtmlGenerate, aiReview, aiBroadcastDraft } from "../../lib/aiClient";
import { readAiChatHandoff, postAiChatResult } from "../../lib/aiChat";
import type { AiChatSource, AiChatSeed } from "../../lib/aiChat";
import { errMessage } from "../../lib/errors";
import type {
  AiFeature, HtmlSanitizeInfo, ReviewIssue, BcDraft, BcWarning, BcTarget,
} from "../../lib/ai/types";

interface ModeMeta { ic: string; name: string; quick: string[]; placeholder: string }
const MODE_META: Partial<Record<AiFeature, ModeMeta>> = {
  html_generate: {
    ic: "④", name: "HTMLコード生成",
    quick: ["見出しと本文に整える", "箇条書きに変換", "内容を表にする", "申込CTAボタンを末尾に追加", "既存を崩さず整形"],
    placeholder: "例：料金表を3行の表にして。1泊2日 12,000円 / 2泊3日 22,000円",
  },
  review: {
    ic: "③", name: "メッセージ添削",
    quick: ["リスク表現を重点的に", "敬語・誤字を直す", "もっと簡潔に", "やわらかいトーンに"],
    placeholder: "添削したい文面を貼り付け、または送信してください",
  },
  broadcast_draft: {
    ic: "⑤", name: "配信原稿生成",
    quick: ["共感型で", "要点を絞って", "締切を訴求", "初参加者にも配慮"],
    placeholder: "伝えたいことを箇条書きで（例：8/10 体験会 / 申込8/8まで / 特典あり）",
  },
};

type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "ai"; kind: "html"; html: string; info: HtmlSanitizeInfo }
  | { id: number; role: "ai"; kind: "review"; issues: ReviewIssue[]; revised: string }
  | { id: number; role: "ai"; kind: "drafts"; drafts: BcDraft[]; warnings: BcWarning[] }
  | { id: number; role: "ai"; kind: "text"; text: string }
  | { id: number; role: "ai"; kind: "error"; text: string };

let seq = 1;
const nextId = () => seq++;

export function AiChatConsole() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<AiFeature>("html_generate");
  const [source, setSource] = useState<AiChatSource>({ screen: "—" });
  const [seed, setSeed] = useState<AiChatSeed>({});
  const [token, setToken] = useState<string>("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  // 受け渡しデータの取り込み
  useEffect(() => {
    const h = readAiChatHandoff();
    if (h) {
      setMode(h.mode);
      setSource(h.source);
      setSeed(h.seed);
      setToken(h.token);
      // 添削・配信は初期文面をプリフィル
      if (h.mode === "review" && typeof h.seed.draft === "string") setInput(h.seed.draft);
      if (h.mode === "broadcast_draft" && typeof h.seed.points === "string") setInput(h.seed.points);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2200); };
  const push = (t: Turn) => setTurns((prev) => [...prev, t]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    push({ id: nextId(), role: "user", text });
    setInput("");
    setBusy(true);
    try {
      if (mode === "html_generate") {
        const res = await aiHtmlGenerate({ instruction: text, currentHtml: String(seed.html ?? ""), selection: null });
        push({ id: nextId(), role: "ai", kind: "html", html: res.html, info: res.sanitized });
      } else if (mode === "review") {
        const res = await aiReview({ draft: text, conversationId: (typeof seed.conversationId === "number" ? seed.conversationId : null) });
        push({ id: nextId(), role: "ai", kind: "review", issues: res.issues, revised: res.revised });
      } else if (mode === "broadcast_draft") {
        const target = seed.target as BcTarget | undefined;
        if (!target) { push({ id: nextId(), role: "ai", kind: "error", text: "配信先の情報が渡されていません。配信編集画面から起動してください。" }); return; }
        const res = await aiBroadcastDraft({
          purpose: "announce", tone: "friendly", length: "standard", emoji: "few",
          points: text, target, useVariables: true, useAudience: true,
        });
        push({ id: nextId(), role: "ai", kind: "drafts", drafts: res.drafts, warnings: res.warnings });
      } else {
        push({ id: nextId(), role: "ai", kind: "error", text: "この用途はこの画面では未対応です。" });
      }
    } catch (e) {
      push({ id: nextId(), role: "ai", kind: "error", text: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const applyHtml = (html: string) => { const ok = postAiChatResult(token, { html }); showToast(ok ? "元の編集画面に反映しました" : "呼び出し元が見つかりません（このタブ単体で開いています）"); };
  const applyText = (text: string) => { const ok = postAiChatResult(token, { text }); showToast(ok ? "元の画面に反映しました" : "呼び出し元が見つかりません（このタブ単体で開いています）"); };

  const meta = MODE_META[mode] ?? { ic: "AI", name: "AIチャット", quick: [], placeholder: "メッセージを入力…" };

  if (!ready) return <div className="h-screen grid place-items-center text-gray-400 text-sm">読み込み中…</div>;

  return (
    <div className="flex flex-col h-screen bg-[#f7f8fa]">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2 font-extrabold text-gray-700 text-[15px] whitespace-nowrap">
            <span className="inline-block w-0 h-0" style={{ borderLeft: "9px solid #ee1c25", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />
            KAWAI CAMP <span className="text-[11px] font-semibold text-gray-400">AIチャット</span>
          </div>
          {/* 呼び出し元 */}
          <div className="flex items-center gap-2 pl-3 ml-1 border-l border-gray-200 min-w-0">
            <span className="w-[22px] h-[22px] rounded-md bg-gray-100 text-gray-600 grid place-items-center shrink-0" title="呼び出し元画面">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
            </span>
            <span className="text-[10.5px] font-bold text-gray-400">呼び出し元</span>
            <b className="text-[12.5px] text-gray-700">{source.screen}</b>
            {(source.crumbs ?? []).map((c, i) => (
              <span key={i} className="flex items-center gap-2 min-w-0">
                <span className="text-gray-300">›</span>
                <span className="text-[12px] text-gray-500 truncate max-w-[200px]">{c}</span>
              </span>
            ))}
          </div>
          <div className="flex-1" />
          {/* 用途（呼び出し元で固定・変更不可） */}
          <div className="flex items-center gap-2 border border-gray-200 bg-gray-50 rounded-lg px-3 py-1.5" title="用途は呼び出し元画面で決まります（変更不可）">
            <span className="w-[22px] h-[22px] rounded-md bg-red-50 text-red-600 grid place-items-center text-[12px] font-extrabold">{meta.ic}</span>
            <span className="text-[13px] font-bold text-gray-700">{meta.name}</span>
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">呼び出し元に準拠</span>
          </div>
          <button onClick={() => window.close()} className="text-gray-400 text-sm px-2 py-1.5 hover:text-gray-600">✕</button>
        </div>
      </header>

      {/* 会話 */}
      <main ref={threadRef} className="flex-1 overflow-y-auto py-6">
        <div className="max-w-[820px] mx-auto px-5 flex flex-col gap-4">
          {turns.length === 0 && (
            <div className="text-center text-gray-400 text-[13px] py-10">
              下の入力欄から始めてください。生成結果は「反映」で呼び出し元の画面に戻せます。
            </div>
          )}
          {turns.map((t) => <TurnView key={t.id} t={t} onApplyHtml={applyHtml} onApplyText={applyText} />)}
          {busy && (
            <div className="flex gap-3"><Ava ai /><div className="rounded-2xl rounded-tl bg-white border border-gray-200 px-4 py-3 text-[13px] text-gray-400">生成中…</div></div>
          )}
        </div>
      </main>

      {/* 入力 */}
      <footer className="bg-white border-t border-gray-200 shrink-0 pt-3 pb-4">
        <div className="max-w-[820px] mx-auto px-5">
          {meta.quick.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {meta.quick.map((q) => (
                <button key={q} onClick={() => setInput(q)} className="text-[11.5px] text-gray-700 bg-white border border-gray-200 rounded-full px-3 py-1 hover:border-red-300 hover:text-red-600 hover:bg-red-50">{q}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2.5 items-end border border-gray-200 rounded-2xl pl-3.5 pr-2 py-2 bg-white focus-within:border-red-300">
            <textarea value={input} rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={meta.placeholder}
              className="flex-1 border-none outline-none resize-none text-[13.5px] text-gray-700 bg-transparent max-h-[130px] py-1" />
            <button onClick={send} disabled={busy || !input.trim()}
              className="bg-red-600 text-white rounded-xl w-10 h-10 text-lg shrink-0 disabled:opacity-40 hover:bg-red-700">➤</button>
          </div>
          <div className="text-[10.5px] text-gray-400 mt-2 text-center">Enterで送信 ／ Shift+Enterで改行　—　用途は呼び出し元画面で固定</div>
        </div>
      </footer>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 bg-gray-700 text-white text-[12.5px] px-4 py-2 rounded-full z-50">{toast}</div>
      )}
    </div>
  );
}

function Ava({ ai }: { ai?: boolean }) {
  return ai
    ? <div className="w-[30px] h-[30px] rounded-lg bg-red-50 text-red-600 grid place-items-center text-[12px] font-extrabold shrink-0">AI</div>
    : <div className="w-[30px] h-[30px] rounded-lg bg-gray-700 text-white grid place-items-center text-[12px] font-extrabold shrink-0 order-2">私</div>;
}

function TurnView({ t, onApplyHtml, onApplyText }: {
  t: Turn; onApplyHtml: (html: string) => void; onApplyText: (text: string) => void;
}) {
  if (t.role === "user") {
    return (
      <div className="flex gap-3 justify-end">
        <Ava />
        <div className="rounded-2xl rounded-tr bg-gray-700 text-white px-4 py-3 text-[13.5px] max-w-[640px] whitespace-pre-wrap">{t.text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Ava ai />
      <div className="rounded-2xl rounded-tl bg-white border border-gray-200 px-4 py-3 text-[13.5px] max-w-[660px] w-full">
        {t.kind === "html" && <HtmlResult html={t.html} info={t.info} onApply={onApplyHtml} />}
        {t.kind === "review" && <ReviewResult issues={t.issues} revised={t.revised} onApply={onApplyText} />}
        {t.kind === "drafts" && <DraftsResult drafts={t.drafts} warnings={t.warnings} onApply={onApplyText} />}
        {t.kind === "text" && <p className="m-0 whitespace-pre-wrap">{t.text}</p>}
        {t.kind === "error" && <p className="m-0 text-red-600">{t.text}</p>}
      </div>
    </div>
  );
}

function HtmlResult({ html, info, onApply }: { html: string; info: HtmlSanitizeInfo; onApply: (html: string) => void }) {
  const removed = info.removedTags.length + info.removedAttrs.length;
  return (
    <div>
      <p className="mt-0 mb-2">HTMLを生成しました。プレビューを確認して反映できます。</p>
      <pre className="bg-gray-900 text-gray-100 rounded-lg px-3 py-2.5 text-[11.5px] font-mono leading-relaxed overflow-auto max-h-[160px] whitespace-pre-wrap break-all">{html}</pre>
      <div className="border border-gray-200 rounded-lg overflow-hidden my-2">
        <div className="text-[10.5px] text-gray-500 bg-gray-50 px-2.5 py-1 border-b border-gray-100">プレビュー（掲載時の見え方）</div>
        <div className="p-3.5"><div className="content-rich text-[13.5px] leading-7 text-gray-700" dangerouslySetInnerHTML={{ __html: html }} /></div>
      </div>
      <div className="text-[10.5px] mb-2">
        {removed === 0
          ? <span className="text-green-700">安全チェック：危険なタグ・属性は検出されませんでした</span>
          : <span className="text-amber-700">除去：{[...info.removedTags, ...info.removedAttrs].join(", ")}</span>}
      </div>
      <button onClick={() => onApply(html)} className="bg-red-600 text-white text-[12px] font-bold px-3.5 py-2 rounded-lg hover:bg-red-700">▸ このHTMLを反映</button>
    </div>
  );
}

function ReviewResult({ issues, revised, onApply }: { issues: ReviewIssue[]; revised: string; onApply: (text: string) => void }) {
  return (
    <div>
      <p className="mt-0 mb-2">{issues.length > 0 ? `${issues.length}件の指摘があります。` : "大きな問題は見つかりませんでした。"}</p>
      {issues.map((it, i) => (
        <div key={i} className={`border-l-2 pl-2.5 py-1 mb-1.5 ${it.severity === "critical" ? "border-red-500 bg-red-50/60" : it.severity === "warning" ? "border-amber-500 bg-amber-50/60" : "border-gray-300 bg-gray-50"}`}>
          <div className="text-[11px] font-bold text-gray-600">{it.category}</div>
          <div className="text-[12px]"><span className="line-through text-gray-400">{it.quote}</span> → <span className="text-gray-800">{it.fix}</span></div>
          <div className="text-[10.5px] text-gray-400">{it.reason}</div>
        </div>
      ))}
      <div className="border border-gray-200 rounded-lg p-2.5 my-2 bg-gray-50 text-[12.5px] whitespace-pre-wrap">{revised}</div>
      <button onClick={() => onApply(revised)} className="bg-red-600 text-white text-[12px] font-bold px-3.5 py-2 rounded-lg hover:bg-red-700">▸ 修正後を入力欄に反映</button>
    </div>
  );
}

function DraftsResult({ drafts, warnings, onApply }: { drafts: BcDraft[]; warnings: BcWarning[]; onApply: (text: string) => void }) {
  return (
    <div>
      <p className="mt-0 mb-2">{drafts.length}案を作成しました。選んで反映できます（送信は呼び出し元で人が行います）。</p>
      {drafts.map((d, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-2.5 mb-2 bg-white">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-extrabold text-red-600">{d.label}</span>
            <span className="text-[10.5px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{d.approach}</span>
          </div>
          <div className="text-[12.5px] whitespace-pre-wrap">{d.text}</div>
          <button onClick={() => onApply(d.text)} className="mt-2 bg-red-600 text-white text-[11.5px] font-bold px-3 py-1.5 rounded-lg hover:bg-red-700">▸ この案を反映</button>
        </div>
      ))}
      {warnings.map((w, i) => (
        <div key={i} className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mt-1">{w.message}</div>
      ))}
    </div>
  );
}
