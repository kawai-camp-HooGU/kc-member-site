"use client";
// ============================================================
// HTMLメール本文を「安全に」表示するコンポーネント。
//   二重防御：
//     1) DOMPurify でサニタイズ（script/style/on* などを除去）
//     2) sandbox="" の iframe（別オリジン扱い・スクリプト不可・スタイル隔離）に srcdoc 表示
//   さらに：
//     - リモート画像は既定でブロック（開封トラッキング／IP露出の防止）
//       「画像を表示」で明示的に許可
//     - リンクは新しいタブ（<base target="_blank">）
//   ⚠️ サニタイズはブラウザでのみ実行（DOMPurify は window 依存）。
// ============================================================
import { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";

function sanitize(html: string): string {
  if (typeof window === "undefined") return ""; // SSR時は空（実表示はクライアント）
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    ADD_ATTR: ["target"],
  });
}

export default function HtmlMailFrame({ html }: { html: string }) {
  const [showImages, setShowImages] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const clean = useMemo(() => sanitize(html), [html]);
  const blockedCount = useMemo(() => (clean.match(/<img\b/gi) ?? []).length, [clean]);

  const srcDoc = useMemo(() => {
    // 画像ブロック時は src を data-src へ退避して読み込ませない
    const body = showImages ? clean : clean.replace(/<img\b/gi, "<img data-blocked ").replace(/\bsrc=/gi, "data-src=");
    const csp = `default-src 'none'; img-src ${showImages ? "https: data:" : "'none'"}; style-src 'unsafe-inline'; font-src 'none'`;
    return `<!DOCTYPE html><html><head>` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank">` +
      `<style>html,body{margin:0;padding:8px;font:13px/1.75 "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,sans-serif;color:#1f2937;word-break:break-word}a{color:#2563eb}img{max-width:100%;height:auto}</style>` +
      `</head><body>${body}</body></html>`;
  }, [clean, showImages]);

  return (
    <div className="space-y-2">
      {blockedCount > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <span>プライバシー保護のため画像{showImages ? "を表示中" : `${blockedCount}枚をブロック中`}です。</span>
          <button onClick={() => setShowImages((v) => !v)}
            className="ml-auto font-bold text-amber-800 underline">
            {showImages ? "画像を隠す" : "画像を表示"}
          </button>
        </div>
      )}
      <iframe
        ref={frameRef}
        title="html-mail"
        sandbox=""
        srcDoc={srcDoc}
        className="w-full min-h-[240px] border border-gray-200 rounded-lg bg-white"
        onLoad={(e) => {
          // 内容に合わせて高さを調整（同一オリジンではないため best-effort）
          try {
            const doc = (e.currentTarget as HTMLIFrameElement).contentDocument;
            if (doc?.body) e.currentTarget.style.height = `${Math.min(doc.body.scrollHeight + 24, 1200)}px`;
          } catch { /* sandbox によりアクセス不可でも既定高さで表示 */ }
        }}
      />
    </div>
  );
}
