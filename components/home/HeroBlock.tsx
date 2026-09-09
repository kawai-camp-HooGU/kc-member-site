"use client";
// ============================================================
// ヒーロー「今月これだけは」（REQ-094）
//
//   運営が差し替える唯一の枠。だから掲載期限を必須にしてある
//   （期限切れは isBlockVisible() が弾くので、ここには来ない）。
//
//   ⚠️ 画像は ThumbFrame を使わない。
//      ThumbFrame は fluid/固定枠のどちらも object-contain（切り抜かない）が設計思想で、
//      cover モードを持たない。ヒーローは高さ固定＋cover なので専用に描く。
//   ⚠️ 画像URLは必ず toImageUrl() を通す。運営が Google ドライブの /view URL を
//      貼るのは既知の事象で、通さないと白い箱になる。
// ============================================================
import { useMemo } from "react";
import { toImageUrl } from "../../lib/contents";
import { pickForBlock } from "../../lib/homeBlocks";
import type { HomePool } from "../../lib/homeBlocks";
import { HOME_SECTION, HOME_HERO_FALLBACK, HOME_HERO_H } from "../../lib/constants";
import type { HomeBlock, CmsContent, ContentPage, ContentKind } from "../../lib/models";
import type { AttrIndex } from "../../lib/members";

const KIND_LABEL: Record<ContentKind, string> = { video: "動画", doc: "資料", none: "記事" };

export interface HeroBlockProps {
  block: HomeBlock;
  pool: HomePool;
  myId: number | null;
  myAttrs: number[];
  idx: AttrIndex;
  seeAll: boolean;
  seen: Set<number>;
  onOpen: (c: CmsContent, page: ContentPage | undefined) => void;
  /** セクション／ページを指しているときの遷移 */
  onOpenSection: (sectionId: number) => void;
  onOpenPage: (page: ContentPage) => void;
}

export function HeroBlock({
  block: b, pool, myId, myAttrs, idx, seeAll, seen, onOpen, onOpenSection, onOpenPage,
}: HeroBlockProps) {
  // ソースが content / auto のときは1件を引く。section / page はその入口へ飛ばす。
  const target: CmsContent | null = useMemo(() => {
    if (b.sourceMode !== "content" && b.sourceMode !== "auto" && b.sourceMode !== "manual") return null;
    const one = { ...b, kind: "shelf" as const, config: { ...b.config, limit: 1 } };
    // auto は「未視聴の先頭1件」。continue と同じ考え方で未視聴に絞る。
    if (b.sourceMode === "auto") {
      const list = pickForBlock(
        { ...one, kind: "continue" as const, config: { ...b.config, limit: 1 } },
        pool, myId, myAttrs, idx, seeAll,
      );
      return list[0] ?? null;
    }
    return pickForBlock(one, pool, myId, myAttrs, idx, seeAll)[0] ?? null;
  }, [b, pool, myId, myAttrs, idx, seeAll]);

  const page = target ? pool.pages.find((p) => p.id === target.pageId) : undefined;

  // 画像：運営が config.imageUrl を入れていればそれ、無ければ対象のサムネ、無ければ既定
  const img = toImageUrl(b.config.imageUrl || target?.thumbUrl || "");

  // 出すものが何も決まっていないヒーローは描かない（空の赤い箱を出さない）
  const hasTarget =
    target != null || b.sourceSectionId != null || b.sourcePageId != null || !!b.config.lead;
  if (!hasTarget && !b.title) return null;

  const heading = b.title || target?.name || "";
  const cta = b.config.ctaLabel || (target?.kind === "doc" ? "開く" : "見る");
  const meta = target
    ? `${KIND_LABEL[target.kind]} ／ ${seen.has(target.id) ? "視聴済" : "未視聴"}`
    : "";

  const go = (): void => {
    if (target) { onOpen(target, page); return; }
    if (b.sourcePageId != null) {
      const p = pool.pages.find((x) => x.id === b.sourcePageId);
      if (p) { onOpenPage(p); return; }
    }
    if (b.sourceSectionId != null) onOpenSection(b.sourceSectionId);
  };

  return (
    <section className={HOME_SECTION}>
      <div
        className={`relative overflow-hidden rounded-2xl text-white flex items-end
                    px-5 py-5 sm:px-6 sm:py-6 ${HOME_HERO_H}`}
        style={
          img
            ? {
                backgroundImage:
                  `linear-gradient(180deg,rgba(10,10,12,.15) 0%,rgba(10,10,12,.66) 55%,rgba(10,10,12,.90) 100%), url("${img.replace(/"/g, "%22")}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundImage: HOME_HERO_FALLBACK }
        }
      >
        <div className="relative z-10 max-w-[620px]">
          <span className="inline-block rounded bg-red-600 text-white text-[11px] font-black
                           tracking-widest px-2.5 py-1 mb-2.5">今月これだけは</span>
          <h2 className="text-[22px] sm:text-[26px] font-black leading-snug tracking-tight m-0 mb-1.5"
            style={{ wordBreak: "auto-phrase", textShadow: "0 2px 14px rgba(0,0,0,.35)" }}>
            {heading}
          </h2>
          {b.config.lead && (
            <p className="hidden sm:block text-[14px] leading-relaxed text-white/90 m-0 mb-3.5 max-w-[540px]">
              {b.config.lead}
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={go}
              className="rounded-[10px] bg-white text-red-700 text-[14px] font-black px-6 py-2.5
                         hover:bg-red-50 transition-colors">
              {cta}
            </button>
            {meta && <span className="text-[12px] font-bold text-white/75">{meta}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
