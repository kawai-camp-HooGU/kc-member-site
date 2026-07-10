"use client";
// 設定 ＞ 初回メッセージ：初回ログイン時に運営から送るウェルカムメッセージを管理する。
//   - ON/OFF、既定文面、流入経路別の文面（分岐）を設定
import { useEffect, useState } from "react";
import { loadAppSettings, saveAppSettings } from "../../lib/supabase";
import type { AppSettings, WelcomeRoute } from "../../lib/models";
import { DEFAULT_APP_SETTINGS } from "../../lib/models";
import { errMessage } from "../../lib/errors";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

export function WelcomeTab() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadAppSettings().then((s) => { setSettings(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const patch = (p: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...p }));
  const patchRoute = (i: number, p: Partial<WelcomeRoute>) =>
    setSettings((s) => ({ ...s, welcomeRoutes: s.welcomeRoutes.map((r, idx) => idx === i ? { ...r, ...p } : r) }));
  const addRoute = () => setSettings((s) => ({ ...s, welcomeRoutes: [...s.welcomeRoutes, { key: "", label: "", message: "" }] }));
  const delRoute = (i: number) => setSettings((s) => ({ ...s, welcomeRoutes: s.welcomeRoutes.filter((_, idx) => idx !== i) }));

  const save = async () => {
    // キー重複・空キーの検証
    const routes = settings.welcomeRoutes.map((r) => ({ ...r, key: r.key.trim(), label: r.label.trim() || r.key.trim() }));
    const keys = routes.map((r) => r.key).filter(Boolean);
    if (keys.length !== new Set(keys).size) { setMsg({ ok: false, text: "経路キーが重複しています" }); return; }
    if (routes.some((r) => !r.key)) { setMsg({ ok: false, text: "経路キーは必須です（空欄の行を削除するか入力してください）" }); return; }
    setSaving(true); setMsg(null);
    try {
      await saveAppSettings({ ...settings, welcomeRoutes: routes });
      setSettings((s) => ({ ...s, welcomeRoutes: routes }));
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
      <p className="text-xs text-gray-400">メンバーが初めてログインした時に、運営（事務局）から自動でチャットにメッセージを送ります。流入経路ごとに文面を分けられます（経路は招待時にメンバーへ付与）。</p>

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

      {/* 経路別文面 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-gray-800">流入経路ごとの文面（分岐）</div>
            <div className="text-[11px] text-gray-400">「経路キー」は招待時に付与する識別子。一致すればその文面を優先します。</div>
          </div>
          <button onClick={addRoute} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700">＋ 経路を追加</button>
        </div>

        {settings.welcomeRoutes.length === 0 && (
          <p className="text-[12px] text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">経路はまだありません。「＋ 経路を追加」で作成します。</p>
        )}

        <div className="space-y-3">
          {settings.welcomeRoutes.map((r, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input className={`${inputCls} flex-1`} value={r.key} placeholder="経路キー（例: seminar, ad_google）"
                  onChange={(e) => patchRoute(i, { key: e.target.value })} />
                <input className={`${inputCls} flex-1`} value={r.label} placeholder="表示名（例: セミナー経由）"
                  onChange={(e) => patchRoute(i, { label: e.target.value })} />
                <button onClick={() => delRoute(i)} className="text-red-500 text-xs whitespace-nowrap px-1">削除</button>
              </div>
              <textarea className={`${inputCls} min-h-[70px] resize-y`} value={r.message} placeholder="この経路のメンバーへ送る文面"
                onChange={(e) => patchRoute(i, { message: e.target.value })} />
            </div>
          ))}
        </div>
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
