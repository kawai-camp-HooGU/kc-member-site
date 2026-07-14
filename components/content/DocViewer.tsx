"use client";
// ============================================================
// 資料（PDF）のプレビュー＋ダウンロード
//
//   アップロード方式（filePath あり）のときに使う。
//   ・プレビュー … 署名URL（5分）を iframe で表示
//   ・ダウンロード … 同じく署名URL。download 付きなのでブラウザで開かず保存される
//
//   ⚠️ URLはサーバー（/api/content/download）が閲覧権限を確認してから発行する。
//      ブラウザから Storage を直接叩いても、バケットが private なので取得できない。
//   ⚠️ 発行のたびに content_downloads に1行記録される。
//      プレビュー表示だけでもログが立つ（＝「見た」も記録に残る）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { requestDownloadUrl, formatBytes } from "../../lib/contents";
import { Icon } from "../common/Icon";

interface Props {
  contentId: number;
  fileName: string;
  fileSize: number;
  title: string;
}

export function DocViewer({ contentId, fileName, fileSize, title }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 署名URLを取り直す（5分で失効するため、押されたタイミングで発行する） */
  const fetchUrl = useCallback(async (): Promise<string | null> => {
    const r = await requestDownloadUrl(contentId);
    if (r.error || !r.url) { setErr(r.error ?? "取得できませんでした"); return null; }
    setErr(null);
    return r.url;
  }, [contentId]);

  // プレビュー用に1本取る
  useEffect(() => { fetchUrl().then(setUrl); }, [fetchUrl]);

  const download = async () => {
    setBusy(true);
    const u = await fetchUrl();
    setBusy(false);
    if (u) window.location.href = u;   // download 付きの署名URL＝そのまま保存される
  };

  const isPdf = /\.pdf$/i.test(fileName);

  return (
    <div>
      {err && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</p>
      )}

      {/* プレビュー（PDF のみ。それ以外の拡張子はブラウザが表示できないのでカードだけ出す） */}
      {isPdf && url && (
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50" style={{ height: 560 }}>
          <iframe src={url} title={title} style={{ width: "100%", height: "100%", border: 0 }} />
        </div>
      )}

      <div className="flex items-center gap-2.5 mt-3 border border-gray-200 rounded-xl px-3.5 py-3 bg-white">
        <span className="text-indigo-600 shrink-0"><Icon name="doc" size={20} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-800 truncate">{fileName || "資料"}</div>
          {fileSize > 0 && <div className="text-[11px] text-gray-400">{formatBytes(fileSize)}</div>}
        </div>
        <button onClick={download} disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
          <Icon name="download" size={16} /> {busy ? "準備中…" : "ダウンロード"}
        </button>
      </div>
    </div>
  );
}
