// ============================================================
// 公開URL（/p/[token]）で表示するコンテンツページ本体。
//   ページ概要＋配下の「閲覧可能なコンテンツ一覧」を出す。
//   各コンテンツは個別公開URL（/c/{token}）へのリンク。
//   外部公開ONなら未ログインの外部ユーザにもこの画面がそのまま見える。
// ============================================================
import { toImageUrl } from "../../lib/contents";
import { ThumbFrame } from "./ThumbFrame";
import { LogoMark } from "../layout/LogoMark";

const KIND_PILL: Record<string, string> = {
  video: "bg-red-50 text-red-600",
  doc: "bg-indigo-50 text-indigo-600",
  none: "bg-emerald-50 text-emerald-600",
};
const KIND_LABEL: Record<string, string> = { video: "動画", doc: "資料", none: "記事" };

export interface PublicPageCard {
  id: number; name: string; kind: string; thumbUrl: string; href: string;
}

export function PublicPage({
  page, contents, external,
}: {
  page: { name: string; overview: string };
  contents: PublicPageCard[];
  external: boolean;
}) {
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
        <h1 className="text-xl font-extrabold mb-1.5 text-gray-900">{page.name}</h1>
        {page.overview ? (
          <p className="text-[13.5px] text-gray-600 leading-relaxed whitespace-pre-line mb-5">{page.overview}</p>
        ) : (
          <div className="mb-5" />
        )}

        {contents.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl px-8 py-10 text-center text-sm text-gray-500">
            表示できるコンテンツがありません。
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
