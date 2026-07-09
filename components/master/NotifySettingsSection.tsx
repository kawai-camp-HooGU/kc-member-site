"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/notifyCategories";
import { NotifyToggle } from "./NotifyToggle";
import { NotifyTemplateEditor } from "./NotifyTemplateEditor";
import type { NotifyAppMap, NotifyAppSetting, NotifyValues } from "./formTypes";

export function NotifySettingsSection() {
  const [map, setMap]         = useState<NotifyAppMap | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("notify_settings").select("*");
      const m: NotifyAppMap = {};
      CATEGORIES.forEach((c) => { m[c.key] = { enabled: true, header: "", lead: "", taskLine: "", tail: "" }; });
      if (!error) (data ?? []).forEach((r) => {
        m[r.category] = { enabled: r.enabled !== false, header: r.header ?? "", lead: r.lead ?? "", taskLine: r.task_line ?? "", tail: r.tail ?? "" };
      });
      setMap(m);
    })();
  }, []);

  const update = (key: string, patch: Partial<NotifyAppSetting>) => {
    setMap((prev) => prev ? { ...prev, [key]: { ...prev[key], ...patch } as NotifyAppSetting } : prev);
    setSavedAt(null);
  };

  const save = async () => {
    if (!map) return;
    setSaving(true);
    const rows = CATEGORIES.map((c) => {
      const s = map[c.key]!;
      return { category: c.key, enabled: s.enabled, header: s.header || null, lead: s.lead || null, task_line: s.taskLine || null, tail: s.tail || null, updated_at: new Date().toISOString() };
    });
    const { error } = await supabase.from("notify_settings").upsert(rows, { onConflict: "category" });
    setSaving(false);
    if (!error) setSavedAt(Date.now()); else alert("保存に失敗しました: " + error.message);
  };

  if (!map) return <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-400">設定を読み込み中…</div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-gray-700">文面・通知ON/OFF設定（アプリ全体）</p>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-600">保存しました</span>}
          <button type="button" onClick={save} disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">{saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-2">ここがアプリ全体の既定です。OFFにしたカテゴリは送信されません。文面は各プロジェクトで個別に上書きできます。</p>
      {CATEGORIES.map((c) => {
        const s = map[c.key]!;
        const open = expanded === c.key;
        return (
          <div key={c.key} className="border-t border-gray-100 py-2">
            <div className="flex items-center gap-2">
              <NotifyToggle on={s.enabled} onClick={() => update(c.key, { enabled: !s.enabled })} />
              <span className={`flex-1 text-sm ${s.enabled ? "text-gray-700" : "text-gray-400"}`}>{c.tabLabel}</span>
              <button type="button" onClick={() => setExpanded(open ? null : c.key)}
                className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap">{open ? "閉じる ▲" : "文面を編集 ▼"}</button>
            </div>
            {open && <NotifyTemplateEditor cat={c} values={s} fallback={{}} onChange={(v: NotifyValues) => update(c.key, v)} />}
          </div>
        );
      })}
    </div>
  );
}
