"use client";
// ============================================================
// アップロード動画（mp4等）のインライン再生
//
//   コンテンツ種別＝動画 で、YouTube 等のURLではなくファイルを
//   アップロードした（filePath あり）ときに使う。
//
//   ・署名URL（5分・preview）を取り、<video controls> で再生する。
//   ・URLはサーバー（/api/content/download）が閲覧権限を確認してから発行する。
//     資料（DocViewer）と同じ経路・同じ権限判定を通る。
//   ⚠️ preview モードなのでダウンロードログは残さない（＝再生では記録しない）。
//      「保存」動線は出さない（動画は視聴させる想定。右クリック保存は塞がない）。
//   ⚠️ 署名URLは5分で失効する。長い動画の途中で切れないよう、失効が近づいたら
//      取り直す（再生位置は保持する）。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { requestDownloadUrl } from "../../lib/contents";

interface Props {
  contentId: number;
  title: string;
}

export function VideoPlayer({ contentId, title }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchUrl = useCallback(async () => {
    const r = await requestDownloadUrl(contentId, "preview");
    if (r.error || !r.url) { setErr(r.error ?? "動画を取得できませんでした"); return; }
    setErr(null); setUrl(r.url);
  }, [contentId]);

  useEffect(() => { void fetchUrl(); }, [fetchUrl]);

  // 署名URLは5分で失効する。4分ごとに取り直し、再生位置と再生状態を引き継ぐ。
  useEffect(() => {
    const t = window.setInterval(async () => {
      const v = videoRef.current;
      const at = v?.currentTime ?? 0;
      const playing = v ? !v.paused : false;
      const r = await requestDownloadUrl(contentId, "preview");
      if (!r.url) return;
      setUrl(r.url);
      // src 差し替えで頭出しに戻るので、次の loadedmetadata で位置を復元する
      requestAnimationFrame(() => {
        const el = videoRef.current;
        if (!el) return;
        const restore = () => {
          el.currentTime = at;
          if (playing) void el.play().catch(() => {});
          el.removeEventListener("loadedmetadata", restore);
        };
        el.addEventListener("loadedmetadata", restore);
      });
    }, 4 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [contentId]);

  if (err) {
    return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>;
  }
  if (!url) {
    return (
      <div className="rounded-xl bg-black grid place-items-center text-white/50 text-sm" style={{ aspectRatio: "16 / 9" }}>
        読み込み中…
      </div>
    );
  }
  return (
    <div className="rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={url} title={title} controls controlsList="nodownload" playsInline
        style={{ width: "100%", height: "100%", background: "#000" }} />
    </div>
  );
}
