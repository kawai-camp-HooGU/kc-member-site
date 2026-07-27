"use client";
// LINE友だちのアバター。プロフィール画像があれば表示し、無ければ頭文字の色付き円。
import { avatarColor, initial } from "./lineUtils";

export interface FriendAvatarProps {
  name: string;
  pictureUrl?: string;
  /** 色を安定させる種（userId 推奨）。無ければ name を使う */
  seed?: string;
  /** ピクセルサイズ（既定 32） */
  size?: number;
}

export function FriendAvatar({ name, pictureUrl, seed, size = 32 }: FriendAvatarProps) {
  const px = `${size}px`;
  if (pictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="rounded-full object-cover flex-shrink-0 bg-gray-100"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <span
      className="rounded-full grid place-items-center text-white font-bold flex-shrink-0"
      style={{ width: px, height: px, background: avatarColor(seed || name), fontSize: `${Math.round(size * 0.42)}px` }}
    >
      {initial(name)}
    </span>
  );
}
