"use client";
// ============================================================
// ホームの棚に並ぶ1枚（REQ-094）
//
//   一覧は軽く、詳細は深く。カードに載せるのは
//   サムネイル・タイトル・1行のメタ（種別／視聴状態）だけにする。
//
//   ⚠️ 種別ピルは ContentView の KIND_PILL を流用しない。
//      あちらは資料＝藍・記事＝緑の多色で、ホームに持ち込むと
//      brand.md §1（赤の濃淡＋無彩色）に反し、緑が「視聴済」と衝突する。
//      ホーム用の HOME_KIND_PILL（lib/constants.ts）を使う。
// ============================================================
import type { CSSProperties } from "react";
import { ThumbFrame } from "../content/ThumbFrame";
import { toImageUrl, THUMB_ASPECT } from "../../lib/contents";
import { HOME_KIND_PILL, HOME_THUMB_FALLBACK } from "../../lib/constants";
import { Icon } from "../common/Icon";
import type { CmsContent, ContentKind } from "../../lib/models";

const KIND_LABEL: Record<ContentKind, string> = { video: "動画", doc: "資料", none: "記事" };
/** [未, 済]。ContentView の SEEN_LABEL と同じ語彙に揃える */
const SEEN_LABEL: Record<ContentKind, [string, string]> = {
  video: ["未視聴", "視聴済"],
  doc:   ["未読", "既読"],
  none:  ["未読", "閲覧済"],
};

export interface ContentCardProps {
  content: CmsContent;
  seen: boolean;
  onOpen: () => void;
  /** 左下に出す順位（ランキングのみ）。1位だけ色を変える */
  rank?: number;
  /** 右上の「NEW」バッジ */
  isNew?: boolean;
  /** メタ行の先頭に足す一言（「今週 24人が視聴」など） */
  note?: string;
  /** 一覧の先頭4枚だけ即時読み込みにする（残りは遅延） */
  eager?: boolean;
}

export function ContentCard({
  content: c, seen, onOpen, rank, isNew = false, note, eager = false,
}: ContentCardProps) {
  const url = toImageUrl(c.thumbUrl);
  const frame: CSSProperties = { aspectRatio: THUMB_ASPECT };
  const [unLabel, seenLabel] = SEEN_LABEL[c.kind];

  return (
    <button
      onClick={onOpen}
      className="group shrink-0 w-[176px] sm:w-[186px] text-left"
      aria-label={c.name}
    >
      <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-900
                      transition-shadow group-hover:shadow-lg" style={frame}>
        {url ? (
          <ThumbFrame src={url} className="w-full h-full" style={frame} />
        ) : (
          <span aria-hidden className="absolute inset-0"
            style={{ background: HOME_THUMB_FALLBACK[c.kind] ?? HOME_THUMB_FALLBACK.doc }} />
        )}

        {/* 動画は再生マーク、資料・記事は書類マーク（絵文字は使わない。brand.md §6） */}
        <span className="absolute inset-0 flex items-center justify-center text-white/90">
          <span className="w-9 h-9 rounded-full bg-white/92 text-red-700 flex items-center justify-center">
            <Icon name={c.kind === "video" ? "content" : "doc"} size={17} />
          </span>
        </span>

        {rank != null && (
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2"
            style={{ background: "linear-gradient(0deg,rgba(0,0,0,.55),rgba(0,0,0,0))" }} />
        )}
        {rank != null && (
          <span className={`absolute left-2 bottom-0 text-[42px] leading-[.92] font-black tabular-nums
                            ${rank === 1 ? "text-red-300" : "text-white"}`}
            style={{ textShadow: "0 2px 12px rgba(0,0,0,.65)" }}>{rank}</span>
        )}
        {isNew && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-600 text-white
                           text-[10px] font-black px-1.5 py-0.5 tracking-wider">NEW</span>
        )}
        {/* eager は将来 img へ渡す。いまは ThumbFrame 側が <img> を持つため印だけ残す */}
        <span hidden data-eager={eager ? "1" : "0"} />
      </div>

      <div className="text-[14px] font-bold text-gray-900 leading-relaxed mt-2 line-clamp-2">
        {c.name}
      </div>
      <div className="text-[12px] text-gray-500 font-bold mt-0.5">
        {note ? `${note} ／ ` : ""}
        <span className={`inline-block rounded-full px-1.5 ${HOME_KIND_PILL[c.kind] ?? ""}`}>
          {KIND_LABEL[c.kind]}
        </span>
        {" ／ "}
        <span className={seen ? "text-emerald-700" : ""}>{seen ? seenLabel : unLabel}</span>
      </div>
    </button>
  );
}
