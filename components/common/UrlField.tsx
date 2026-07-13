"use client";
// ============================================================
// 発行済みURLの表示フィールド（読み取り専用 ＋ コピー ＋ 開く）
//   お知らせ／フォーム／コンテンツの編集画面で共通に使う。
//   未保存（IDやトークンが未発行）のときは「保存すると発行されます」を出す。
// ============================================================
import { useToast } from "./ToastProvider";

interface Props {
  label: string;
  /** 相対パス（例: "/content/12"）。空なら未発行として扱う */
  path: string;
  hint?: string;
  /** 未発行時に出す文言 */
  emptyText?: string;
  /** 新しいタブで開くか（会員ポータル内のURLも別タブで確認できるようにする） */
  openInNewTab?: boolean;
}

/** 相対パス → 絶対URL（SSR時は NEXT_PUBLIC_SITE_URL、ブラウザでは現在のオリジン） */
export function absoluteUrl(path: string): string {
  if (!path) return "";
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");
  return `${base}${path}`;
}

export function UrlField({ label, path, hint, emptyText = "保存すると発行されます", openInNewTab = true }: Props) {
  const toast = useToast();
  const url = absoluteUrl(path);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URLをコピーしました");
    } catch {
      toast.error("コピーできませんでした（URLを選択して手動でコピーしてください）");
    }
  };

  return (
    <div>
      <label className="text-xs font-bold text-gray-500 block mb-1">
        {label} {hint && <span className="text-gray-400 font-normal">{hint}</span>}
      </label>
      {url ? (
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[12.5px] bg-gray-100 text-gray-600 font-mono focus:outline-none"
            value={url} readOnly onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={copy}
            className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">
            コピー
          </button>
          <a href={url} target={openInNewTab ? "_blank" : undefined} rel="noopener noreferrer"
            className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">
            開く ↗
          </a>
        </div>
      ) : (
        <input
          className="w-full border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 italic"
          value={emptyText} readOnly
        />
      )}
    </div>
  );
}
