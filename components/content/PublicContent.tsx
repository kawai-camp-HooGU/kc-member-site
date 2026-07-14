// ============================================================
// 公開URL（/c/[token]）で表示するコンテンツ本体。
//   外部公開ONなら未ログインの外部ユーザにも、この画面がそのまま見える。
//   会員ポータルの ContentView 詳細と同じ見た目に揃えている。
// ============================================================
import { toEmbedUrl, toImageUrl } from "../../lib/contents";
import { ThumbFrame } from "./ThumbFrame";
import { DocViewer } from "./DocViewer";
import { renderBodyHtml } from "../../lib/richText";
import type { CmsContent } from "../../lib/models";

const KIND_PILL: Record<string, string> = {
  video: "bg-red-50 text-red-600",
  doc: "bg-indigo-50 text-indigo-600",
  none: "bg-emerald-50 text-emerald-600",
};
const KIND_LABEL: Record<string, string> = { video: "動画", doc: "資料", none: "記事" };

export function PublicContent({ c, pageName, external }: { c: CmsContent; pageName: string; external: boolean }) {
  const body = c.noneMode === "html" ? c.bodyHtml.trim() : c.bodyText.trim();

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <span className="text-sm font-extrabold tracking-wide text-neutral-900">KAWAI CAMP</span>
          {pageName ? <span className="text-[11.5px] text-gray-400">{pageName}</span> : null}
          <span className="flex-1" />
          {external ? (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">外部公開</span>
          ) : null}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-6">
        <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* サムネ：会員ポータル詳細と同じ。幅100%・高さは画像なり（左右の余白ゼロ） */}
          {c.thumbUrl ? (
            <ThumbFrame src={toImageUrl(c.thumbUrl)} big fluid className="border-b border-gray-100" />
          ) : null}

          <div className="p-6">
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${KIND_PILL[c.kind] ?? KIND_PILL.none}`}>
              {KIND_LABEL[c.kind] ?? "記事"}
            </span>
            <h1 className="text-xl font-extrabold mt-2.5 mb-2 text-gray-900">{c.name}</h1>
            <p className="text-xs text-gray-400 mb-5">
              登録日時：{c.createdAt ? c.createdAt.replace("T", " ").slice(0, 16) : "—"}
            </p>

            {c.kind === "video" && (c.url ? (
              <div className="rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
                <iframe
                  src={toEmbedUrl(c.url)} title={c.name}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen style={{ width: "100%", height: "100%", border: 0 }}
                />
              </div>
            ) : <p className="text-sm text-gray-400">動画URLが未設定です。</p>)}

            {/* 資料：アップロード（署名URL・ログあり）を優先。無ければ従来の外部URL埋め込み。 */}
            {c.kind === "doc" && (c.filePath ? (
              <DocViewer contentId={c.id} fileName={c.fileName} fileSize={c.fileSize} title={c.name} />
            ) : c.url ? (
              <div>
                <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 460 }}>
                  <iframe src={toEmbedUrl(c.url)} title={c.name} style={{ width: "100%", height: "100%", border: 0 }} />
                </div>
                <a href={c.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
                  新しいタブで開く ↗
                </a>
              </div>
            ) : <p className="text-sm text-gray-400">資料が未設定です。</p>)}

            {body ? (
              <div className={`text-[15px] leading-8 text-gray-700 content-rich ${c.kind !== "none" ? "mt-5" : ""}`}
                dangerouslySetInnerHTML={{ __html: renderBodyHtml(c.noneMode, c.bodyText, c.bodyHtml) }} />
            ) : null}
          </div>
        </article>

        <p className="text-[11.5px] text-gray-400 text-center mt-5 leading-relaxed">
          {external
            ? <>このページはログイン不要でご覧いただけます。会員の方は <a href="/login" className="text-red-500 underline">ログイン</a> するとすべてのコンテンツを閲覧できます。</>
            : <>会員限定のコンテンツです。<a href="/" className="text-red-500 underline">ポータルへ戻る</a></>}
        </p>
      </main>
    </div>
  );
}

/** 見つからない／閲覧できないときの共通画面 */
export function PublicContentNotice({
  title, message, action,
}: { title: string; message: string; action?: { href: string; label: string } }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-6">
      <div className="bg-white border border-gray-200 rounded-2xl px-8 py-10 text-center max-w-sm w-full">
        <p className="text-sm font-bold text-gray-800 mb-1.5">{title}</p>
        <p className="text-[12.5px] text-gray-500 leading-relaxed whitespace-pre-line">{message}</p>
        {action ? (
          <a href={action.href}
            className="inline-block mt-5 px-6 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
            {action.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}
