// ============================================================
// 公開URL（/p/[token]）で表示するコンテンツページ本体。
//   ページ概要＋配下の「閲覧可能なコンテンツ一覧」を出す。
//   各コンテンツは個別公開URL（/c/{token}）へのリンク。
//   外部公開ONなら未ログインの外部ユーザにもこの画面がそのまま見える。
// ============================================================
import { toImageUrl, toEmbedUrl } from "../../lib/contents";
import { ThumbFrame } from "./ThumbFrame";
import { VideoPlayer } from "./VideoPlayer";
import { DocViewer } from "./DocViewer";
import { renderBodyHtml } from "../../lib/richText";
import { LogoMark } from "../layout/LogoMark";

const KIND_PILL: Record<string, string> = {
  video: "bg-red-50 text-red-600",
  doc: "bg-indigo-50 text-indigo-600",
  none: "bg-emerald-50 text-emerald-600",
};
const KIND_LABEL: Record<string, string> = { video: "動画", doc: "資料", none: "記事" };

export interface PublicPageCard {
  id: number; name: string; kind: string; thumbUrl: string; href: string;
  // ── layout='embed' でのインライン描画に使う（cards では未使用）──
  url?: string; noneMode?: string; bodyText?: string; bodyHtml?: string;
  filePath?: string; fileName?: string; fileSize?: number; createdAt?: string;
}

// ── 埋め込みレイアウト（layout='embed'）の1コンテンツぶんの描画 ──
//   /c の詳細（PublicContent）と同じ見た目で、動画プレーヤー・PDFビューア・本文HTMLを出す。
//   記事（kind=none）は本文HTMLをそのまま全面描画し、余計な見出しを足さない。
function EmbedItem({ c, no }: { c: PublicPageCard; no?: number }) {
  const noneMode = c.noneMode ?? "text";
  const body = (noneMode === "html" ? (c.bodyHtml ?? "") : (c.bodyText ?? "")).trim();

  // 案2：記事（kind=none）はカード枠・余白を外し、本文HTMLを全幅で描画（ヒーローが左右いっぱいに出る）
  if (c.kind === "none") {
    return body ? (
      <div className="text-[15px] leading-8 text-gray-700 content-rich"
        dangerouslySetInnerHTML={{ __html: renderBodyHtml(noneMode, c.bodyText ?? "", c.bodyHtml ?? "") }} />
    ) : null;
  }

  return (
    <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="p-6">
        {/* 案1：連番（01/02…）＋赤ライン＋タイトルのLP風見出し */}
        <div className="flex items-center gap-2.5 mb-3">
          {no != null && (
            <span className="text-lg font-extrabold text-red-600 tabular-nums leading-none">{String(no).padStart(2, "0")}</span>
          )}
          <span className="w-6 h-0.5 bg-red-600 rounded-full" />
          <span className="text-base font-bold text-gray-900">{c.name}</span>
        </div>

        {c.kind === "video" && (c.filePath ? (
          <VideoPlayer contentId={c.id} title={c.name} />
        ) : c.url ? (
          <div className="rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={toEmbedUrl(c.url)} title={c.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen style={{ width: "100%", height: "100%", border: 0 }}
            />
          </div>
        ) : <p className="text-sm text-gray-400">動画URLが未設定です。</p>)}

        {c.kind === "doc" && (c.filePath ? (
          <DocViewer contentId={c.id} fileName={c.fileName ?? ""} fileSize={c.fileSize ?? 0} title={c.name} />
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

        {/* 案3：本文があれば、区切り線＋控えめな文字で「解説」として表示 */}
        {body ? (
          <div className="border-t border-gray-100 mt-4 pt-3 text-[14px] leading-8 text-gray-600 content-rich"
            dangerouslySetInnerHTML={{ __html: renderBodyHtml(noneMode, c.bodyText ?? "", c.bodyHtml ?? "") }} />
        ) : null}
      </div>
    </article>
  );
}

export function PublicPage({
  page, contents, external,
}: {
  page: { name: string; overview: string; layout?: string };
  contents: PublicPageCard[];
  external: boolean;
}) {
  const embed = page.layout === "embed";
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center gap-2.5">
          <LogoMark box="w-8 h-8" />
          <span className="text-base font-bold tracking-wide text-white leading-none">KAWAI CAMP</span>
          <span className="flex-1" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-6">
        {/* 案5：埋め込みレイアウトでは管理用のページ名・概要を出さない（記事ヒーローを主役にする） */}
        {!embed && (
          <>
            <h1 className="text-xl font-extrabold mb-1.5 text-gray-900">{page.name}</h1>
            {page.overview ? (
              <p className="text-[13.5px] text-gray-600 leading-relaxed whitespace-pre-line mb-5">{page.overview}</p>
            ) : (
              <div className="mb-5" />
            )}
          </>
        )}

        {contents.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl px-8 py-10 text-center text-sm text-gray-500">
            表示できるコンテンツがありません。
          </div>
        ) : embed ? (
          /* 埋め込みレイアウト：並び順にインライン描画。動画・資料に連番を振る（案1・案4） */
          <div className="space-y-8">
            {(() => {
              let n = 0;
              return contents.map((c) => {
                const no = c.kind === "none" ? undefined : ++n;
                return <EmbedItem key={c.id} c={c} no={no} />;
              });
            })()}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {contents.map((c) => (
              <li key={c.id}>
                <a
                  href={c.href}
                  className="block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow"
                >
                  {c.thumbUrl ? (
                    <ThumbFrame src={toImageUrl(c.thumbUrl)} className="border-b border-gray-100" />
                  ) : (
                    <div className="h-32 bg-gray-50 border-b border-gray-100" />
                  )}
                  <div className="p-4">
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${KIND_PILL[c.kind] ?? KIND_PILL.none}`}>
                      {KIND_LABEL[c.kind] ?? "記事"}
                    </span>
                    <p className="text-[15px] font-bold mt-2 text-gray-900 line-clamp-2">{c.name}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="py-8 text-center text-[11px] text-gray-400">KAWAI CAMP</footer>
    </div>
  );
}
