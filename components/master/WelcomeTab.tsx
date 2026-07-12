"use client";
// ============================================================
// 設定 ＞ 初回メッセージ
//   初回ログイン時に運営から自動送信するウェルカムメッセージを管理する。
//
//   ⚠️ Phase 3 の変更点：
//   経路の「定義」は 設定 ＞ 流入経路（SourceTab）へ移した。
//   このタブは「経路を選んで文面を書く」だけになる。
//     ・経路の追加／削除／停止 → 流入経路タブ
//     ・経路ごとの文面         → ここ（welcome_messages テーブル）
//     ・既定文面               → ここ（app_settings.welcome_default）
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { loadAppSettings, saveAppSettings } from "../../lib/supabase";
import type { AppSettings, Source } from "../../lib/models";
import { DEFAULT_APP_SETTINGS, SOURCE_CATEGORY_LABEL } from "../../lib/models";
import { fetchSources, fetchWelcomeMessages, saveWelcomeMessage } from "../../lib/sources";
import { errMessage } from "../../lib/errors";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

export function WelcomeTab() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [sources, setSources]   = useState<Source[]>([]);
  /** sources.id → 文面 */
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, srcs, wms] = await Promise.all([loadAppSettings(), fetchSources(), fetchWelcomeMessages()]);
        setSettings(s);
        setSources(srcs);
        setMessages(Object.fromEntries(wms.map((w) => [w.sourceId, w.message])));
      } catch (e) {
        setMsg({ ok: false, text: errMessage(e) });
      }
      setLoading(false);
    })();
  }, []);

  const patch = (p: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...p }));
  const setMessage = (sourceId: number, text: string) =>
    setMessages((m) => ({ ...m, [sourceId]: text }));

  // 停止中の経路でも、既に文面が入っていれば編集できるように残す
  const visible = useMemo(
    () => sources.filter((s) => s.isActive || (messages[s.id] ?? "").trim()),
    [sources, messages],
  );

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await saveAppSettings(settings);
      await Promise.all(visible.map((s) => saveWelcomeMessage(s.id, messages[s.id] ?? "")));
      setMsg({ ok: true, text: "保存しました" });
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">読み込み中...</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-gray-400">
        メンバーが初めてログインした時に、運営（事務局）から自動でチャットにメッセージを送ります。
        流入経路ごとに文面を分けられます。
      </p>

      {/* ON/OFF */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
        <div>
          <div className="text-sm font-bold text-gray-800">初回メッセージを有効にする</div>
          <div className="text-[11px] text-gray-400">OFFの間は送信されません。</div>
        </div>
        <button onClick={() => patch({ welcomeEnabled: !settings.welcomeEnabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${settings.welcomeEnabled ? "bg-red-600" : "bg-gray-300"}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${settings.welcomeEnabled ? "translate-x-5" : ""}`} />
        </button>
      </div>

      {/* 既定文面 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <label className="text-sm font-bold text-gray-800 block">既定メッセージ</label>
        <p className="text-[11px] text-gray-400">流入経路が未設定、または経路に一致する文面が無い場合に送信します。</p>
        <textarea className={`${inputCls} min-h-[90px] resize-y`} value={settings.welcomeDefault}
          onChange={(e) => patch({ welcomeDefault: e.target.value })}
          placeholder="はじめまして！KAWAI CAMP 事務局です。ご不明点があればこのチャットからお気軽にご連絡ください😊" />
      </div>

      {/* 経路別文面（経路の定義は「流入経路」タブ） */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-gray-800">流入経路ごとの文面（分岐）</div>
          <div className="text-[11px] text-gray-400">
            空欄の経路には既定メッセージが送られます。経路の追加・停止は
            <span className="font-semibold text-gray-500">「設定 ＞ 流入経路」</span>で行います。
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-[12px] text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">
            流入経路がまだありません。「設定 ＞ 流入経路」で作成してください。
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((s) => (
              <div key={s.id} className={`border border-gray-200 rounded-xl p-3 space-y-2 ${s.isActive ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="text-sm font-bold text-gray-800">{s.label}</span>
                  <span className="text-[11px] text-gray-400 font-mono">{s.key}</span>
                  <span className="text-[10.5px] text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
                    {SOURCE_CATEGORY_LABEL[s.category]}
                  </span>
                  {!s.isActive && <span className="text-[10.5px] text-gray-400">（停止中）</span>}
                </div>
                <textarea className={`${inputCls} min-h-[70px] resize-y`}
                  value={messages[s.id] ?? ""}
                  placeholder="この経路のメンバーへ送る文面（空欄なら既定メッセージ）"
                  onChange={(e) => setMessage(s.id, e.target.value)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 保存 */}
      <div className="flex items-center gap-3">
        {msg && <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
        <button onClick={save} disabled={saving}
          className="ml-auto text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
