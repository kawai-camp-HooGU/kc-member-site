"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/notifyCategories";
import { NotifyTemplateEditor } from "./NotifyTemplateEditor";
import type { NotifyOverrides, NotifyAppMap, NotifyValues } from "./formTypes";

export interface ProjectNotifySettingsProps {
  overrides: Record<string, unknown> | undefined;
  onChange: (ov: NotifyOverrides) => void;
}

export function ProjectNotifySettings({ overrides, onChange }: ProjectNotifySettingsProps) {
  const [appMap, setAppMap]   = useState<NotifyAppMap | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("notify_settings").select("*");
      const m: NotifyAppMap = {};
      if (!error) (data ?? []).forEach((r) => {
        m[r.category] = { enabled: r.enabled !== false, header: r.header ?? "", lead: r.lead ?? "", taskLine: r.task_line ?? "", tail: r.tail ?? "" };
      });
      setAppMap(m);
    })();
  }, []);

  const ov = (overrides || {}) as NotifyOverrides;
  const setMode = (key: string, mode: string) => onChange({ ...ov, [key]: { ...(ov[key] || {}), mode } });
  const setText = (key: string, vals: NotifyValues) => onChange({ ...ov, [key]: { ...(ov[key] || {}), ...vals } });

  const ModeSeg = ({ value, onPick }: { value: string; onPick: (k: string) => void }) => {
    const opts = [
      { k: "inherit", l: "継承", cls: "bg-blue-50 text-red-700" },
      { k: "on",      l: "ON",  cls: "bg-green-50 text-green-700" },
      { k: "off",     l: "OFF", cls: "bg-red-50 text-red-600" },
    ];
    return (
      <span className="inline-flex border border-gray-300 rounded-md overflow-hidden text-[11px] shrink-0">
        {opts.map((o, i) => (
          <button key={o.k} type="button" onClick={() => onPick(o.k)}
            className={`px-2.5 py-1 ${i > 0 ? "border-l border-gray-200" : ""} ${value === o.k ? o.cls : "text-gray-400 hover:bg-gray-50"}`}>{o.l}</button>
        ))}
      </span>
    );
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xs font-semibold text-gray-600">カテゴリ別の通知設定</label>
        <span className="text-[11px] text-gray-400">継承 = アプリ全体の既定に従う</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-1.5">このプロジェクトだけ送信ON/OFFや文面を上書きできます（未設定はアプリ全体を継承）。</p>
      {appMap === null ? (
        <p className="text-xs text-gray-400">通知設定を読み込み中…</p>
      ) : CATEGORIES.map((c) => {
        const o = ov[c.key] || {};
        const mode = o.mode || "inherit";
        const open = expanded === c.key;
        const hasText = !!(o.header || o.lead || o.taskLine || o.tail);
        return (
          <div key={c.key} className="border-t border-gray-50 py-1.5 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className={`flex-1 text-xs ${mode === "off" ? "text-gray-400" : "text-gray-700"}`}>{c.tabLabel}</span>
              <ModeSeg value={mode} onPick={(m) => setMode(c.key, m)} />
              <button type="button" onClick={() => setExpanded(open ? null : c.key)}
                className={`text-[11px] whitespace-nowrap ${hasText ? "text-red-600" : "text-gray-400"} hover:text-red-700`}>
                {open ? "閉じる ▲" : hasText ? "上書き中 ▼" : "文面 ▼"}
              </button>
            </div>
            {open && (
              <NotifyTemplateEditor cat={c}
                values={{ header: o.header ?? "", lead: o.lead ?? "", taskLine: o.taskLine ?? "", tail: o.tail ?? "" }}
                fallback={appMap[c.key] || {}}
                onChange={(vals) => setText(c.key, vals)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
