// ============================================================
// コンテンツ本文の描画（REQ-106）
//
//   本文HTMLに書かれた埋め込みトークン
//     <div data-embed="{public_token}"></div>
//   を、その場で EmbedItem（動画プレーヤー／資料ビューア／記事）へ差し替えて描く。
//
//   ⚠️ 本文の描画は必ずここを通すこと。
//      renderBodyHtml() を直接 dangerouslySetInnerHTML へ渡す書き方に戻すと、
//      その画面だけトークンが効かなくなり、運営から見て挙動がばらつく。
//
//   ⚠️ トークンは「運営がこれを埋め込みたい」という意思表示にすぎない。
//      **描いてよいかどうかは resolve() の側で必ず判定する。**
//      ここは resolve() が返したものを描くだけで、権限判定はしない。
//
//   ⚠️ EmbedItem とは相互 import になる（EmbedItem の本文もここを通るため）。
//      どちらも関数宣言なので巻き上げが効き、参照は描画時まで遅延される。
//      アロー関数の const へ書き換えないこと（初期化順で壊れる）。
// ============================================================
import { splitEmbedTokens } from "../../lib/embedToken";
import { renderBodyHtml, type BodyMode } from "../../lib/richText";
import { EmbedItem, type EmbedItemData } from "./EmbedItem";

/** トークン → 描いてよいコンテンツ。権限が無い／見つからないときは null を返す */
export type EmbedResolver = (token: string) => EmbedItemData | null;

/**
 * 埋め込み先として認めてよい種別か（REQ-106 確認事項3b・4a）。
 *
 *   ・動画／資料は**アップロード方式（filePath あり）だけ**。
 *     URL方式（YouTube・ドライブ）は iframe を直接描く経路で、
 *     /api/content/download の再判定が効かないため対象外にする。
 *   ・記事（none）は本文だけなので、そのまま許可する。
 */
export function isEmbeddable(d: EmbedItemData | null | undefined): d is EmbedItemData {
  if (!d) return false;
  if (d.kind === "video" || d.kind === "doc") return !!d.filePath;
  return d.kind === "none";
}

interface Props {
  mode: BodyMode | string | null | undefined;
  bodyText: string | null | undefined;
  bodyHtml: string | null | undefined;
  /** 本文ラッパに付けるクラス（従来 dangerouslySetInnerHTML を載せていた div と同じもの） */
  className?: string;
  /** 参照の解決。渡さない＝トークンを解決しない（＝従来どおりの描画） */
  resolve?: EmbedResolver;
  /** 再帰の深さ。0 のときだけ参照を解決する（入れ子の中の入れ子は描かない） */
  depth?: number;
  /** 既に描いたコンテンツID。自己参照・相互参照を止める */
  seen?: ReadonlySet<number>;
  /**
   * 解決できなかったトークンを枠で知らせる（運営プレビュー専用）。
   *   会員・公開側では必ず false のままにすること。
   *   「閲覧権限が無い」と「貼り間違い」は見分けられないので、
   *   これを出すとコンテンツの存在が漏れる。
   */
  showUnresolved?: boolean;
}

export function RichBody({ mode, bodyText, bodyHtml, className, resolve, depth = 0, seen, showUnresolved = false }: Props) {
  const html = renderBodyHtml(mode, bodyText, bodyHtml);

  // テキストモード・参照解決なし・深さ1以上 … いずれも従来どおり1枚で描く。
  //   ⚠️ ここは「トークンを使っていない既存本文の DOM を変えない」ための分岐でもある。
  //      分割が要らないときに余計なラッパ div を挟むと、
  //      .content-rich > *:first-child の効き方が変わって余白がずれる。
  if (mode !== "html" || !resolve || depth > 0) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const parts = splitEmbedTokens(html);
  if (parts.length === 1 && parts[0].type === "html") {
    return <div className={className} dangerouslySetInnerHTML={{ __html: parts[0].html }} />;
  }

  const nextSeen = seen ?? new Set<number>();

  return (
    <div className={className}>
      {parts.map((p, i) => {
        if (p.type === "html") {
          if (!p.html.trim()) return null;
          return <div key={`h${i}`} className="rb-part" dangerouslySetInnerHTML={{ __html: p.html }} />;
        }
        const target = resolve(p.token);
        // 解決できない／権限が無い／埋め込み対象外 → ブロックごと出さない（存在を知らせない）
        if (!isEmbeddable(target) || nextSeen.has(target.id)) {
          if (!showUnresolved) return null;
          return (
            <div key={`u${i}`} className="rb-unresolved">
              埋め込み未解決：<code>{p.token}</code>
              <span className="block text-[11px] font-normal mt-0.5">
                トークンが違う／非公開／削除済み、またはアップロードされていない動画・資料です
              </span>
            </div>
          );
        }
        const childSeen = new Set(nextSeen);
        childSeen.add(target.id);
        return (
          <div key={`e${i}-${target.id}`} className="rb-embed">
            {/* 連番は振らない（確認事項9a）。ページ側の 01/02… と衝突させないため */}
            <EmbedItem c={target} resolve={resolve} depth={depth + 1} seen={childSeen} />
          </div>
        );
      })}
    </div>
  );
}
