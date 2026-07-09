"use client";
import { useState } from "react";
export interface IdHelpLinkProps { img: string; title: string; label?: string; }
export function IdHelpLink({ img, title, label = "調べ方（PDF）" }: IdHelpLinkProps) {
  const [open, setOpen] = useState(false);
  const PDF = "/help/Chatwork_ID_Guide.pdf";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-1 whitespace-nowrap">
        <span className="leading-none">?</span>{label}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
              <div className="text-sm font-semibold text-gray-800">{title}</div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="p-3">
              <img src={img} alt={title} className="w-full rounded-lg border border-gray-100" />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 sticky bottom-0 bg-white">
              <a href={PDF} target="_blank" rel="noopener noreferrer"
                className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-700 hover:bg-blue-50">マニュアル全体を開く（PDF）</a>
              <button onClick={() => setOpen(false)} className="text-sm py-2 px-4 rounded-lg bg-red-600 text-white hover:bg-red-700">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
