"use client";
// ============================================================
// 初期設定ガイド（チュートリアル）  view = "tutorial"
//   STEP 1：Webページをアプリとしてインストール（iPhone/Android/PC 切替の図解）
//   STEP 2：通知をONにする（この端末の有効化。NotificationView と同じ push ロジックを流用）
//   入口：ホームの「初期設定」カード ／ ヘルプ画面
// ============================================================
import { useEffect, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import {
  isPushSupported, permissionState, isSubscribed, subscribeDevice, unsubscribeDevice,
  loadNotifySettings, saveNotifySettings, sendTestPush, DEFAULT_NOTIFY_SETTINGS,
} from "../../lib/push";
import type { NotifySettings } from "../../lib/push";
import { IosPushGuideModal } from "../common/IosPushGuideModal";
import { BlockedPushGuideModal } from "../common/BlockedPushGuideModal";
import { LogoMark } from "./LogoMark";

// STEP1 の図解用スタイル（.tut 配下にスコープ）
const CSS = `
.tut .flow{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;}
.tut .fig{width:calc(33.333% - 14px);min-width:96px;text-align:center;}
.tut .arrow{align-self:center;color:#9ca3af;font-size:18px;padding-top:44px;}
.tut .cap{font-size:11px;color:#1f2937;margin-top:6px;line-height:1.4;}
.tut .cap b{color:#dc2626;}
.tut .ph{width:100%;max-width:110px;margin:0 auto;height:132px;border:5px solid #111827;border-radius:16px;background:#fff;position:relative;overflow:hidden;}
.tut .ph .sb{height:16px;background:#f9fafb;border-bottom:1px solid #eef0f2;}
.tut .ph .body{padding:8px;}
.tut .ln{height:6px;border-radius:3px;background:#eef0f2;margin:5px 0;}
.tut .ln.s{width:60%;} .tut .ln.m{width:85%;}
.tut .ph .bottombar{position:absolute;left:0;right:0;bottom:0;height:22px;background:#f3f4f6;border-top:1px solid #e9ebee;display:flex;align-items:center;justify-content:space-around;}
.tut .dot3{color:#9aa0a6;letter-spacing:2px;font-size:12px;}
.tut .hl{outline:2px solid #ee1c25;box-shadow:0 0 0 3px rgba(238,28,37,.22);border-radius:8px;background:#fef2f2;}
.tut .pill{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:700;color:#374151;background:#fff;border:1px solid #e5e7eb;border-radius:7px;padding:4px 6px;width:100%;justify-content:flex-start;}
.tut .pill.tgt{color:#dc2626;border-color:#ee1c25;background:#fef2f2;}
.tut .ico{width:15px;height:15px;flex-shrink:0;}
.tut .dlg{position:absolute;left:8px;right:8px;bottom:26px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:7px;box-shadow:0 6px 18px rgba(0,0,0,.12);}
.tut .dlg .t{font-size:8px;color:#374151;margin-bottom:6px;line-height:1.3;}
.tut .row{display:flex;gap:5px;}
.tut .btn{flex:1;font-size:8px;font-weight:700;text-align:center;border-radius:6px;padding:4px 0;}
.tut .btn.no{background:#f3f4f6;color:#6b7280;}
.tut .btn.yes{background:#dc2626;color:#fff;}
.tut .win{width:100%;max-width:140px;margin:0 auto;height:118px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;overflow:hidden;}
.tut .win .wb{height:20px;background:#eef1f4;border-bottom:1px solid #e2e6ea;display:flex;align-items:center;gap:5px;padding:0 6px;}
.tut .win .dots{display:flex;gap:3px;}
.tut .win .dots i{width:6px;height:6px;border-radius:50%;background:#cbd5e1;display:block;}
.tut .win .addr{flex:1;height:12px;background:#fff;border:1px solid #e2e6ea;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding:0 2px;}
.tut .win .wbody{padding:9px;}
.tut .win.app .wb{background:#111827;justify-content:center;}
.tut .tabs{display:inline-flex;background:#f3f4f6;border-radius:10px;padding:3px;gap:2px;}
.tut .tabbtn{border:0;background:transparent;border-radius:8px;padding:6px 11px;font-size:11.5px;font-weight:700;color:#6b7280;cursor:pointer;line-height:1.15;font-family:inherit;}
.tut .tabbtn span{display:block;font-size:9px;font-weight:600;color:#9ca3af;margin-top:1px;}
.tut .tabbtn.active{background:#fff;color:#dc2626;box-shadow:0 1px 2px rgba(0,0,0,.08);}
.tut .tabbtn.active span{color:#ee1c25;}
`;

const TRI = `<svg viewBox="0 0 120 104"><path d="M60 6 L114 98 H6 Z" fill="#ee1c25"/><rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff"/><path d="M72 54 L72 80 L54 67 Z" fill="#fff"/></svg>`;

const IOS = `
<div class="flow">
  <div class="fig">
    <div class="ph"><div class="sb"></div><div class="body"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div>
      <div class="bottombar"><span class="dot3">&lsaquo; &rsaquo;</span>
        <span class="hl" style="padding:2px;border-radius:6px;"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg></span>
        <span class="dot3">&#9634;</span></div>
    </div>
    <div class="cap">&#9312; 下部の<b>共有ボタン</b>をタップ</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="ph"><div class="sb"></div><div class="body">
      <span class="pill" style="margin-bottom:5px;">コピー</span>
      <span class="pill tgt"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>ホーム画面に追加</span>
      <span class="pill" style="margin-top:5px;">お気に入り</span>
    </div></div>
    <div class="cap">&#9313;「<b>ホーム画面に追加</b>」を選ぶ</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="ph"><div class="sb" style="display:flex;justify-content:flex-end;align-items:center;padding-right:6px;"><span class="hl" style="font-size:8px;font-weight:800;color:#ee1c25;padding:2px 6px;">追加</span></div>
      <div class="body"><div style="display:flex;gap:6px;align-items:center;"><span style="width:18px;height:16px;display:inline-block;">${TRI}</span><div class="ln m" style="margin:0"></div></div><div class="ln s"></div></div>
    </div>
    <div class="cap">&#9314; 右上の「<b>追加</b>」をタップ</div>
  </div>
</div>`;

const AND = `
<div class="flow">
  <div class="fig">
    <div class="ph"><div class="sb" style="display:flex;align-items:center;gap:4px;padding:0 5px;">
      <span style="flex:1;height:9px;background:#eef0f2;border-radius:4px;"></span>
      <span class="hl" style="padding:0 3px;color:#ee1c25;font-weight:800;font-size:12px;line-height:1;">&#8942;</span>
    </div><div class="body"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div></div>
    <div class="cap">&#9312; 右上の<b>メニュー &#8942;</b> をタップ</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="ph"><div class="sb"></div><div class="body">
      <span class="pill">共有</span>
      <span class="pill tgt" style="margin-top:5px;"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><rect x="4" y="18" width="16" height="3" rx="1"/></svg>アプリをインストール</span>
      <span class="pill" style="margin-top:5px;">履歴</span>
    </div></div>
    <div class="cap">&#9313;「<b>アプリをインストール</b>」を選ぶ</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="ph"><div class="sb"></div><div class="body"><div class="ln m"></div><div class="ln s"></div></div>
      <div class="dlg"><div class="t">このアプリをインストールしますか？</div><div class="row"><span class="btn no">キャンセル</span><span class="btn yes">インストール</span></div></div>
    </div>
    <div class="cap">&#9314;「<b>インストール</b>」をタップ</div>
  </div>
</div>`;

const PC = `
<div class="flow">
  <div class="fig">
    <div class="win"><div class="wb"><span class="dots"><i></i><i></i><i></i></span><span class="addr"><span class="hl" style="padding:0 2px;display:inline-flex;"><svg class="ico" style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v6M9 11l3 3 3-3"/></svg></span></span></div><div class="wbody"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div></div>
    <div class="cap">&#9312; アドレスバー右の<br><b>インストール</b>アイコン</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="win"><div class="wb"><span class="dots"><i></i><i></i><i></i></span><span class="addr"></span></div><div class="wbody">
      <div class="ln s"></div>
      <div style="margin-top:6px;border:1px solid #e5e7eb;border-radius:8px;padding:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);">
        <div style="font-size:8px;color:#374151;margin-bottom:5px;">アプリをインストール</div>
        <div class="row"><span class="btn no">キャンセル</span><span class="btn yes">インストール</span></div>
      </div>
    </div></div>
    <div class="cap">&#9313;「<b>インストール</b>」をクリック</div>
  </div>
  <div class="arrow">&rarr;</div>
  <div class="fig">
    <div class="win app"><div class="wb"><span style="width:12px;height:11px;display:inline-block;">${TRI}</span></div><div class="wbody"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div></div>
    <div class="cap">&#9314; <b>アプリとして起動</b><br>（独立ウィンドウ）</div>
  </div>
</div>`;

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} type="button"
      className={`relative w-[52px] h-[30px] rounded-full shrink-0 transition-colors ${on ? "bg-green-600" : "bg-gray-300"}`}>
      <span className={`absolute top-[3px] w-6 h-6 rounded-full bg-white shadow transition-all ${on ? "left-[25px]" : "left-[3px]"}`} />
    </button>
  );
}

export function TutorialView({ onBack }: { onBack?: () => void }) {
  const { permission } = useMaster();
  const myId = permission.myId;

  const [tab, setTab] = useState<"ios" | "and" | "pc">("ios");
  const [settings, setSettings] = useState<NotifySettings>(DEFAULT_NOTIFY_SETTINGS);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<string>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showIos, setShowIos] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      setPerm(permissionState());
      setSubscribed(await isSubscribed());
      if (myId != null) setSettings(await loadNotifySettings(myId));
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
    const r = await sendTestPush();
    flash(r.ok ? "テスト通知を送信しました" : (r.error ?? "送信に失敗しました"));
    setBusy(false);
  };

  const supported = isPushSupported();
  const off = !settings.enabled;

  const statusChip = !supported
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-red-50 text-red-600">この環境では通知に対応していません</span>
    : perm === "denied"
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-red-50 text-red-600">通知がブロックされています（ブラウザのサイト設定で許可してください）</span>
    : subscribed
    ? <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">✓ この端末は通知を受け取れます</span>
    : <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">この端末は未設定です</span>;

  const html = tab === "ios" ? IOS : tab === "and" ? AND : PC;

  return (
    <div className="tut max-w-3xl mx-auto pb-16">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <button onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 mb-4">← ホームへ戻る</button>

      <div className="flex items-center gap-2.5 mb-2">
        <LogoMark box="w-7 h-7" />
        <h1 className="text-xl font-black text-gray-900 m-0">初期設定ガイド</h1>
      </div>
      <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-7">
        <p className="text-[13px] text-red-900 leading-relaxed m-0">
          KAWAI CAMP を<b>アプリとして使い</b>、大切な<b>お知らせやイベントの通知</b>を受け取るための初期設定です。
        </p>
        <span className="inline-block mt-2 text-[11px] font-bold text-red-600 bg-white border border-red-100 rounded-full px-2.5 py-1">2ステップ ・ 約3分で完了</span>
      </div>

      {/* STEP 1 */}
      <section className="mb-9">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="w-8 h-8 rounded-full bg-red-600 text-white font-black text-sm flex items-center justify-center shrink-0">1</span>
          <h2 className="text-[16px] font-black text-gray-900 m-0"><span className="text-red-600">STEP 1</span>　アプリとしてインストール</h2>
        </div>
        <p className="text-[12.5px] text-gray-500 mb-3 pl-[42px]">お使いの端末のタブを選んでください。ホーム画面に追加すると、ブラウザを開かず1タップで起動できます。</p>
        <div className="pl-[42px]">
          <div className="tabs mb-3">
            {([["ios", "iPhone", "Safari"], ["and", "Android", "Chrome"], ["pc", "PC", "Chrome/Edge"]] as const).map(([k, l, s]) => (
              <button key={k} className={`tabbtn ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}<span>{s}</span></button>
            ))}
          </div>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </section>

      {/* STEP 2 */}
      <section className="mb-7">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="w-8 h-8 rounded-full bg-red-600 text-white font-black text-sm flex items-center justify-center shrink-0">2</span>
          <h2 className="text-[16px] font-black text-gray-900 m-0"><span className="text-red-600">STEP 2</span>　通知をONにする</h2>
        </div>
        <p className="text-[12.5px] text-gray-500 mb-3 pl-[42px]">通知をオンにすると、新しいお知らせ・イベント・チャットの返信をすぐに受け取れます。下のボタンからその場でONにできます。</p>

        <div className="pl-[42px] space-y-3">
          {/* マスタースイッチ */}
          <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[15px] font-bold text-gray-800">通知を有効にする</div>
              <div className="text-xs text-gray-400 mt-1">オフにするとすべての通知を停止します</div>
            </div>
            <Switch on={settings.enabled} onClick={() => update({ enabled: !settings.enabled })} />
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
              ※ iPhone / iPad は Safari の「ホーム画面に追加」でアプリを追加してから有効化してください（iOS 16.4 以降）。
              <button onClick={() => setShowIos(true)} className="ml-1 text-red-600 font-bold underline underline-offset-2 hover:text-red-700">図解つきの手順を見る</button><br />
              ※ ブラウザの通知許可がブロックされている場合は、サイト設定から許可に変更してください。
              <button onClick={() => setShowBlocked(true)} className="ml-1 text-red-600 font-bold underline underline-offset-2 hover:text-red-700">ブロックの解除手順を見る</button>
            </p>
            {perm === "denied" && (
              <div className="mt-3 flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                <span className="text-[12.5px] text-red-800 flex-1 leading-relaxed">この端末では通知が<b>ブロック</b>されています。ブラウザの設定を「許可」に戻さないと有効化できません。</span>
                <button onClick={() => setShowBlocked(true)} className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[12px] font-bold hover:bg-red-700">解除手順を見る</button>
              </div>
            )}
          </div>
        </div>
      </section>

      {subscribed && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
          <span className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 font-black">✓</span>
          <div>
            <div className="text-[14px] font-black text-emerald-800">設定完了です！</div>
            <div className="text-[12px] text-emerald-700">お知らせやイベントの通知が届くようになります。</div>
          </div>
        </div>
      )}

      {showIos && <IosPushGuideModal onClose={() => setShowIos(false)} />}
      {showBlocked && <BlockedPushGuideModal onClose={() => setShowBlocked(false)} />}
      {msg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50">{msg}</div>
      )}
    </div>
  );
}
