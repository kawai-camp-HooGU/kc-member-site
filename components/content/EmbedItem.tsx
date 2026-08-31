// ============================================================
// 埋め込みレイアウト（content_pages.layout = 'embed'）の1コンテンツぶんの描画。
//
//   公開ページ /p（PublicPage）と、会員ページのページ内一覧（ContentView）の
//   【両方】がこの部品を使う。
//
//   ⚠️ 以前は PublicPage.tsx の中に閉じていたため、埋め込み表示は公開URLでしか
//      効かず、サイドバー経由の会員ページは常にカード一覧のままだった（REQ-061）。
//      見た目を二重管理にしないため、共通部品としてここへ切り出している。
//      片側だけ直すと運営が /p で確認した見た目と会員の見え方がずれるので、
//      この部品を直接編集すること（呼び出し側で分岐を増やさない）。
//
//   ・記事（kind=none）… カード枠・余白を外し、本文HTMLを全幅で描画する
//                        （ヒーロー画像が左右いっぱいに出る）
//   ・動画／資料      … 連番（01/02…）＋赤ライン＋タイトルのLP風見出しを付け、
//                        /c の詳細と同じプレーヤー・ビューアをその場に出す
// ============================================================
import { toEmbedUrl } from "../../lib/contents";
import { VideoPlayer } from "./VideoPlayer";
import { DocViewer } from "./DocViewer";
import { renderBodyHtml } from "../../lib/richText";

/**
 * 埋め込み描画に必要な最小の形。
 *   公開ページの PublicPageCard と、会員ページの CmsContent の【共通部分】だけを持つ。
 *   どちらもこの形を満たすので、呼び出し側で変換関数を書かずにそのまま渡せる。
 */
export interface EmbedItemData {
  id: number;
  name: string;
  kind: string;              // "video" | "doc" | "none"
  url?: string;
  noneMode?: string;         // "text" | "html"
  bodyText?: string;
  bodyHtml?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
}

export function EmbedItem({ c, no }: { c: EmbedItemData; no?: number }) {
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
