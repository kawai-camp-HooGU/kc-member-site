"use client";
// ============================================================
// ③成果物カード（種類別プレビュー・rev表示・保存）
//
//   ⚠️ HTML は AI の出力である。サーバーで sanitizeHtml を通してから保存しているが、
//      表示時にもう一度サニタイズしてから描画する（3層防御の3層目）。
//      既存 /api/ai/html-generate と同じ規律に揃える。
//
//   ⚠️ 「作成中」はスケルトンを使わない（brand.md §4）。
//      完成時と同じ高さの枠に「…」と一言だけ出し、行がずれないようにする。
// ============================================================
import { useMemo } from "react";
import { sanitizeHtml } from "../../../lib/ai/sanitize";
import { IcDownload, IcPrinter } from "../icons";
import type { TrialArtifact } from "../../../lib/bot/trial/types";

const FRAME = "bg-[#161513] border border-[#37342f] rounded-xl overflow-hidden";
const HEAD = "flex items-center gap-2 px-3 py-2 border-b border-[#2b2926] text-[11px] text-[#a8a196]";
const BODY_H = "h-[260px]";

/** 成果物を印刷する（PDFはブラウザの印刷でまかなう・決定2a） */
function printArtifact(title: string, html: string): void {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>body{font:14px/1.9 -apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;` +
    `color:#1f2937;margin:32px;max-width:760px}h1,h2,h3,h4{color:#3f3f46}` +
    `table{border-collapse:collapse;width:100%}td,th{border:1px solid #e5e7eb;padding:6px 8px}` +
    `@media print{body{margin:0}}</style></head><body>${html}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

/** テキスト／HTMLをファイルとして保存する */
function download(name: string, body: string, mime: string): void {
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ArtifactPlaceholder({ note }: { note: string }) {
  return (
    <div className={FRAME}>
      <div className={HEAD}>
        成果物
        <span className="bg-[rgba(238,28,37,0.14)] text-[#ff9ea2] rounded px-1.5 py-0.5 font-bold text-[10px]">
          作成中
        </span>
      </div>
      {/* ⚠️ 完成時と同じ高さ。値が入っても行がずれない（brand.md §4） */}
      <div className={`${BODY_H} bg-[#100f0e] flex flex-col items-center justify-center gap-2`}>
        <div className="text-[22px] tracking-[0.18em] text-[#5a564e]">…</div>
        <div className="text-[11px] text-[#736e66]">{note}</div>
      </div>
    </div>
  );
}

export function ArtifactCard({
  artifact, title, isLatest, canRevise,
}: {
  artifact: TrialArtifact;
  title: string;
  isLatest: boolean;
  canRevise: boolean;
}) {
  const isHtml = artifact.kind === "html" || artifact.kind === "pdf";
  const isImage = artifact.kind === "image";

  // ⚠️ 表示前にもう一度サニタイズする（AIの出力を信用しない）
  const safeHtml = useMemo(
    () => (isHtml ? sanitizeHtml(artifact.body).html : ""),
    [isHtml, artifact.body],
  );

  return (
    <div className={FRAME}>
      <div className={HEAD}>
        成果物：{title}
        <span className="bg-[rgba(238,28,37,0.14)] text-[#ff9ea2] rounded px-1.5 py-0.5 font-bold text-[10px]">
          rev.{artifact.revision}
        </span>
        <span className="ml-auto text-[#5a564e] uppercase">{artifact.kind}</span>
      </div>

      <div className={`${BODY_H} overflow-y-auto bg-white`}>
        {isImage ? (
          // ⚠️ url は期限つき署名URL（既定300秒）。切れたら status の再取得で入れ替わる。
          artifact.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artifact.url} alt={title}
              className="w-full h-full object-contain bg-[#f7f8fa]" />
          ) : (
            <div className="h-full flex items-center justify-center text-[12px] text-gray-500">
              画像の読み込み期限が切れました。画面を更新してください
            </div>
          )
        ) : isHtml ? (
          <div
            className="p-4 text-[13px] leading-7 text-gray-800 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <pre className="p-4 text-[13px] leading-7 text-gray-800 whitespace-pre-wrap break-words font-sans">
            {artifact.body}
          </pre>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-[#2b2926] flex-wrap">
        {isLatest ? (
          <>
            {isImage ? (
              // 画像は署名URLを新しいタブで開いて保存してもらう
              //（blob 経由にすると期限切れの扱いが増えるだけで利点がない）
              <a
                href={artifact.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-[11px] text-[#a8a196] border border-[#37342f] rounded-lg px-3 py-1.5 hover:border-[#ee1c25] hover:text-[#ff9ea2] ${artifact.url ? "" : "opacity-40 pointer-events-none"}`}
              >
                <IcDownload className="w-3.5 h-3.5" />画像を開いて保存
              </a>
            ) : (
              <button
                type="button"
                onClick={() => download(
                  isHtml ? `${title}.html` : `${title}.txt`,
                  isHtml ? safeHtml : artifact.body,
                  isHtml ? "text/html" : "text/plain",
                )}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#a8a196] border border-[#37342f] rounded-lg px-3 py-1.5 hover:border-[#ee1c25] hover:text-[#ff9ea2]"
              >
                <IcDownload className="w-3.5 h-3.5" />保存する
              </button>
            )}
            {isHtml && (
              <button
                type="button"
                onClick={() => printArtifact(title, safeHtml)}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#a8a196] border border-[#37342f] rounded-lg px-3 py-1.5 hover:border-[#ee1c25] hover:text-[#ff9ea2]"
              >
                <IcPrinter className="w-3.5 h-3.5" />PDFで保存
              </button>
            )}
            {!canRevise && (
              <span className="text-[10px] text-[#736e66] ml-auto">調整できる回数の上限に達しました</span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-[#736e66]">rev.{artifact.revision}（1つ前）</span>
        )}
      </div>
    </div>
  );
}
