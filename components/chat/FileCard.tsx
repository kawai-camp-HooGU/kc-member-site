"use client";
// 画像以外の添付（PDF・ZIP等）。画像は AttachmentGrid → ImageThumb が描く。
import { useState } from "react";
import type { ChatAttachment } from "../../lib/models";
import { attachmentUrl } from "../../lib/chatStorage";
import { FILECARD_STYLE } from "../../lib/constants";
import { fmtSize, fileExt } from "./chatUtils";
import { Icon } from "../common/Icon";

export interface FileCardProps { attachment: ChatAttachment; out?: boolean; }

export function FileCard({ attachment, out }: FileCardProps) {
  const [loading, setLoading] = useState(false);
  const ext = fileExt(attachment.fileName, attachment.mimeType);
  const cls = FILECARD_STYLE[out ? "painted" : "plain"];
  const open = async (): Promise<void> => {
    setLoading(true);
    const url = await attachmentUrl(attachment.storagePath);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <button type="button" onClick={open} disabled={loading}
      className="flex items-center gap-2.5 text-left w-full">
      <span className={`w-8 h-8 rounded-md grid place-items-center text-[10px] font-extrabold shrink-0 ${cls.badge}`}>{ext}</span>
      <span className="min-w-0">
        <span className={`block text-xs font-bold leading-tight truncate ${cls.name}`}>{attachment.fileName}</span>
        <span className={`block text-[11px] ${cls.size}`}>{fmtSize(attachment.sizeBytes)}</span>
      </span>
      <span className={`ml-1 shrink-0 ${cls.icon}`}>
        {loading ? <span className="text-base">…</span> : <Icon name="download" size={16} />}
      </span>
    </button>
  );
}
