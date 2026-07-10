"use client";
import { useState } from "react";
import type { ChatAttachment } from "../../lib/models";
import { attachmentUrl } from "../../lib/chatStorage";
import { fmtSize, fileExt } from "./chatUtils";

export interface FileCardProps { attachment: ChatAttachment; out?: boolean; }

export function FileCard({ attachment, out }: FileCardProps) {
  const [loading, setLoading] = useState(false);
  const ext = fileExt(attachment.fileName, attachment.mimeType);
  const open = async () => {
    setLoading(true);
    const url = await attachmentUrl(attachment.storagePath);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <button type="button" onClick={open} disabled={loading}
      className="flex items-center gap-2.5 text-left w-full">
      <span className={`w-8 h-8 rounded-md grid place-items-center text-[10px] font-extrabold text-white shrink-0 ${out ? "bg-white/25" : "bg-red-600"}`}>{ext}</span>
      <span className="min-w-0">
        <span className={`block text-xs font-bold leading-tight truncate ${out ? "text-white" : "text-gray-800"}`}>{attachment.fileName}</span>
        <span className={`block text-[11px] ${out ? "text-white/80" : "text-gray-400"}`}>{fmtSize(attachment.sizeBytes)}</span>
      </span>
      <span className={`ml-1 text-base ${out ? "text-white/90" : "text-gray-500"}`}>{loading ? "…" : "⭳"}</span>
    </button>
  );
}
