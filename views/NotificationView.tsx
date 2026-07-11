"use client";
import { useEffect, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import {
  isPushSupported, permissionState, isSubscribed, subscribeDevice, unsubscribeDevice,
  loadNotifySettings, saveNotifySettings, sendTestPush, DEFAULT_NOTIFY_SETTINGS,
} from "../lib/push";
import type { NotifySettings } from "../lib/push";

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} type="button"
      className={`relative w-[52px] h-[30px] rounded-full shrink-0 transition-colors ${on ? "bg-green-600" : "bg-gray-300"}`}>
      <span className={`absolute top-[3px] w-6 h-6 rounded-full bg-white shadow transition-all ${on ? "left-[25px]" : "left-[3px]"}`} />
    </button>
  );
}

export function NotificationView() {
  const { permission } = useMaster();
  const myId = permission.myId;

  const [settings, setSettings] = useState<NotifySettings>(DEFAULT_NOTIFY_SETTINGS);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<string>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setPerm(permissionState());
      setSubscribed(await isSubscribed());
      if (myId != null) setSettings(await loadNotifySettings(myId));
      setLoading(false);
    })();
  }, [myId]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2500); };

  const update = async (patch: Partial<NotifySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (myId != null) await saveNotifySettings(myId, next);
  };

  const toggleDevice = async () => {
    if (myId == null) return;
    setBusy(true);
    if (subscribed && permissionState() === "granted") {
      await unsubscribeDevice();
      setSubscribed(false);
      flash("この端末の通知を解除しました");
    } else {
      const r = await subscribeDevice(myId);
      setPerm(permissionState());
      if (r.ok) { setSubscribed(true); flash("この端末を通知対象に登録しました"); }
      else flash(r.reason ?? "登録に失敗しました");
    }
    setBusy(false);
  };

  const test = async () => {
    if (myId == null) return;
    setBusy(true);
    const r = await sendTestPush(myId);
    flash(r.ok ? "テスト通知を送信しました" : (r.error ?? "送信に失敗しました"));
    setBusy(false);
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;
  if (myId == null) return <p className="text-sm text-gray-400 py-10 text-center">メンバー情報が取得できません。</p>;

  const supported = isPushSupported();
  const off = !settings.enabled;

  const statusChip = !supported
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-red-50 text-red-600">この環境では通知に対応していません</span>
    : perm === "denied"
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-red-50 text-red-600">通知がブロックされています（ブラウザのサイト設定で許可してください）</span>
    : subscribed
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">✓ この端末は通知を受け取れます</span>
    : <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">この端末は未設定です</span>;

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-gray-800 m-0">通知</h1>
        <p className="text-xs text-gray-400 mt-1">受け取る通知の種類と、この端末での通知を設定します</p>
      </div>

      {/* マスタースイッチ */}
      <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 mb-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[15px] font-bold text-gray-800">通知を有効にする</div>
            <div className="text-xs text-gray-400 mt-1">オフにするとすべての通知を停止します</div>
          </div>
          <Switch on={settings.enabled} onClick={() => update({ enabled: !settings.enabled })} />
        </div>
      </div>

      {/* 受け取る通知 */}
      <div className={`bg-white border border-gray-200 rounded-2xl px-5 py-4 mb-4 ${off ? "opacity-45 pointer-events-none" : ""}`}>
        <p className="text-[15px] font-extrabold m-0">受け取る通知</p>
        <p className="text-xs text-gray-400 mt-1 mb-4">種類ごとにオン／オフを切り替えられます</p>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[15px] font-bold text-gray-800">トークの受信</div>
            <div className="text-xs text-gray-400 mt-1">チャットに新しいメッセージが届いたとき</div>
          </div>
          <Switch on={settings.chatEnabled} onClick={() => update({ chatEnabled: !settings.chatEnabled })} />
        </div>
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
          <div className="flex-1">
            <div className="text-[15px] font-bold text-gray-800">お知らせの受信</div>
            <div className="text-xs text-gray-400 mt-1">新しいお知らせが公開されたとき</div>
          </div>
          <Switch on={settings.newsEnabled} onClick={() => update({ newsEnabled: !settings.newsEnabled })} />
        </div>
      </div>

      {/* この端末 */}
      <div className={`bg-white border border-gray-200 rounded-2xl px-5 py-4 ${off ? "opacity-45 pointer-events-none" : ""}`}>
        <p className="text-[15px] font-extrabold m-0 mb-2">この端末の通知（デスクトップ／スマホ）</p>
        <div>{statusChip}</div>
        <div className="flex gap-2.5 flex-wrap mt-3.5">
          <button onClick={toggleDevice} disabled={busy || !supported || perm === "denied"}
            className="px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-[13.5px] font-bold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            {subscribed ? "この端末を解除" : "この端末を有効にする"}
          </button>
          <button onClick={test} disabled={busy || !subscribed}
            className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-[13.5px] font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            テスト送信
          </button>
        </div>
        <p className="text-[11.5px] text-gray-400 mt-3 leading-relaxed">
          ※ iPhone / iPad は Safari の「ホーム画面に追加」でアプリを追加してから有効化してください（iOS 16.4 以降）。<br />
          ※ ブラウザの通知許可がブロックされている場合は、サイト設定から許可に変更してください。
        </p>
      </div>

      {msg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50">{msg}</div>
      )}
    </div>
  );
}
