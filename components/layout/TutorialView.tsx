"use client";
// ============================================================
// 初期設定ガイド（チュートリアル）  view = "tutorial"
//   STEP 1：Webページをアプリとしてインストール（iPhone/Android/PC 切替の"リアル"図解）
//   STEP 2：通知をONにする（この端末の有効化。NotificationView と同じ push ロジックを流用）
//   入口：ホームの「初期設定」タイル ／ ヘルプ画面
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
.tut .tabs{display:inline-flex;background:#f3f4f6;border-radius:10px;padding:3px;gap:2px;}
.tut .tabbtn{border:0;background:transparent;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:700;color:#6b7280;cursor:pointer;line-height:1.15;font-family:inherit;}
.tut .tabbtn span{display:block;font-size:9px;font-weight:600;color:#9ca3af;margin-top:1px;}
.tut .tabbtn.active{background:#fff;color:#dc2626;box-shadow:0 1px 2px rgba(0,0,0,.08);}
.tut .tabbtn.active span{color:#ee1c25;}
.tut .flow{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;}
.tut .fig{width:172px;text-align:center;}
.tut .arw{align-self:center;color:#cbd5e1;font-size:22px;padding-top:80px;}
.tut .cap{font-size:11.5px;color:#374151;margin-top:8px;line-height:1.45;}
.tut .cap b{color:#dc2626;}
.tut .hl{outline:2.5px solid #ee1c25;outline-offset:1px;border-radius:8px;}
.tut .ln{height:7px;border-radius:4px;background:#edeef0;margin:7px 0;} .tut .ln.s{width:55%;} .tut .ln.m{width:82%;}
.tut .tri{display:inline-block;line-height:0;}
/* iPhone Safari */
.tut .iph{width:172px;height:280px;border:8px solid #1f2937;border-radius:30px;background:#fff;position:relative;overflow:hidden;margin:0 auto;box-shadow:0 4px 14px rgba(0,0,0,.12);}
.tut .iph .notch{position:absolute;top:0;left:50%;transform:translateX(-50%);width:56px;height:14px;background:#1f2937;border-radius:0 0 10px 10px;z-index:3;}
.tut .iph .stat{height:22px;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 14px;font-size:9px;font-weight:700;color:#111;}
.tut .iph .stat .r{display:flex;gap:3px;align-items:center;}
.tut .sfbar{margin:2px 10px 0;height:26px;background:#f2f2f4;border-radius:9px;display:flex;align-items:center;justify-content:center;gap:4px;color:#6b7280;font-size:10px;}
.tut .sfbar .lock{width:9px;height:9px;}
.tut .page{padding:10px 12px;}
.tut .sftool{position:absolute;left:0;right:0;bottom:0;height:34px;background:#f7f7f8;border-top:1px solid #e6e7ea;display:flex;align-items:center;justify-content:space-around;padding:0 10px;color:#3b82f6;}
.tut .sftool svg{width:19px;height:19px;}
.tut .sheet{position:absolute;left:6px;right:6px;bottom:6px;background:#f2f2f7;border-radius:16px;padding:8px;box-shadow:0 -4px 20px rgba(0,0,0,.15);}
.tut .grab{width:34px;height:4px;border-radius:2px;background:#c7c7cc;margin:2px auto 8px;}
.tut .approw{display:flex;gap:9px;padding:2px 4px 10px;}
.tut .appic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:8px;font-weight:700;}
.tut .shlist{background:#fff;border-radius:12px;overflow:hidden;}
.tut .shrow{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;font-size:11px;color:#111;border-top:1px solid #f0f0f2;}
.tut .shrow:first-child{border-top:0;}
.tut .shrow.tgt{background:#fef2f2;}
.tut .shrow .ri{width:16px;height:16px;color:#8e8e93;}
.tut .shrow.tgt .ri{color:#dc2626;}
.tut .addbar{display:flex;align-items:center;justify-content:space-between;padding:8px 11px;font-size:11px;border-bottom:1px solid #eee;}
.tut .addbar .c{color:#3b82f6;} .tut .addbar .t{font-weight:700;} .tut .addbar .ok{font-weight:800;color:#3b82f6;}
.tut .addbody{display:flex;gap:9px;align-items:center;padding:12px;}
.tut .aicon{width:40px;height:40px;border-radius:10px;background:#0b1220;display:flex;align-items:center;justify-content:center;}
.tut .aname{border:1px solid #e5e7eb;border-radius:8px;padding:6px 9px;font-size:11px;font-weight:700;flex:1;}
/* Android Chrome */
.tut .and{width:172px;height:280px;border:7px solid #111827;border-radius:22px;background:#fff;position:relative;overflow:hidden;margin:0 auto;box-shadow:0 4px 14px rgba(0,0,0,.12);}
.tut .crbar{height:34px;display:flex;align-items:center;gap:7px;padding:0 9px;border-bottom:1px solid #eef0f2;}
.tut .cromni{flex:1;height:20px;background:#f1f3f4;border-radius:999px;display:flex;align-items:center;gap:5px;padding:0 9px;font-size:9.5px;color:#5f6368;overflow:hidden;white-space:nowrap;}
.tut .crmenu{font-size:16px;color:#5f6368;line-height:1;padding:0 2px;}
.tut .crmenu-sheet{position:absolute;top:34px;right:6px;width:120px;background:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;z-index:4;}
.tut .crmi{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:10px;color:#202124;border-top:1px solid #f1f3f4;}
.tut .crmi:first-child{border-top:0;} .tut .crmi.tgt{background:#fef2f2;color:#dc2626;font-weight:700;}
.tut .crmi svg{width:14px;height:14px;}
.tut .anddlg{position:absolute;left:12px;right:12px;bottom:34px;background:#fff;border-radius:12px;box-shadow:0 8px 26px rgba(0,0,0,.2);padding:12px;}
.tut .anddlg .row{display:flex;gap:9px;align-items:center;margin-bottom:9px;}
.tut .anddlg .btns{display:flex;justify-content:flex-end;gap:12px;font-size:11px;font-weight:800;}
/* PC ブラウザ */
.tut .pc{width:340px;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#fff;margin:0 auto;box-shadow:0 4px 14px rgba(0,0,0,.1);}
.tut .pctab{height:30px;background:#dee1e6;display:flex;align-items:flex-end;padding:0 8px;gap:6px;}
.tut .pctab .tabm{background:#fff;border-radius:8px 8px 0 0;padding:6px 12px;font-size:10px;color:#3c4043;display:flex;align-items:center;gap:6px;max-width:150px;}
.tut .pctab .plus{color:#5f6368;font-size:14px;padding-bottom:4px;}
.tut .pcomni{height:34px;background:#fff;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid #eef0f2;}
.tut .pcurl{flex:1;height:22px;background:#f1f3f4;border-radius:999px;display:flex;align-items:center;gap:6px;padding:0 10px;font-size:10.5px;color:#5f6368;}
.tut .installico{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#5f6368;}
.tut .pcbody{padding:14px;background:#fff;height:96px;}
.tut .popcard{margin:0 auto;width:250px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.16);padding:12px;}
.tut .popcard .row{display:flex;gap:10px;align-items:center;margin-bottom:10px;}
.tut .popcard .btns{display:flex;justify-content:flex-end;gap:8px;}
.tut .btnsm{font-size:11px;font-weight:800;border-radius:8px;padding:6px 14px;}
.tut .btnsm.gray{background:#f1f3f4;color:#3c4043;} .tut .btnsm.blue{background:#1a73e8;color:#fff;}
`;

const TRI = `<svg viewBox="0 0 120 104"><path d="M60 6 L114 98 H6 Z" fill="#ee1c25"/><rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff"/><path d="M72 54 L72 80 L54 67 Z" fill="#fff"/></svg>`;

const IOS = `
<div class="flow">
  <div class="fig">
    <div class="iph"><div class="notch"></div>
      <div class="stat"><span>9:41</span><span class="r">&#9679;&#9679;&#9679; &#128246;</span></div>
      <div class="page"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div>
      <div class="sfbar"><svg class="lock" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>kawaicamp-portal.com</div>
      <div class="sftool">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        <span class="hl" style="padding:2px 4px;"><svg viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 12v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7"/></svg></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6a2 2 0 0 1 2-2h9v16H6a2 2 0 0 1-2-2z"/></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="12" height="12" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2"/></svg>
      </div>
    </div>
    <div class="cap">&#9312; 下部の<b>共有ボタン</b>（&#9633;&#8593;）をタップ</div>
  </div>
  <div class="arw">&rarr;</div>
  <div class="fig">
    <div class="iph"><div class="notch"></div>
      <div class="stat"><span>9:41</span><span class="r">&#9679;&#9679;&#9679; &#128246;</span></div>
      <div class="page" style="padding-bottom:0;opacity:.5;"><div class="ln m"></div><div class="ln s"></div></div>
      <div class="sheet">
        <div class="grab"></div>
        <div class="approw">
          <span class="appic" style="background:#007aff;">Air</span>
          <span class="appic" style="background:#34c759;">&#128172;</span>
          <span class="appic" style="background:#0a84ff;">&#9993;</span>
          <span class="appic" style="background:#5856d6;">&#128203;</span>
        </div>
        <div class="shlist">
          <div class="shrow">コピー<svg class="ri" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></div>
          <div class="shrow tgt" style="font-weight:800;">ホーム画面に追加<svg class="ri" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg></div>
          <div class="shrow">お気に入りに追加<svg class="ri" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.9 6 6.6.5-5 4.3 1.5 6.4L12 17l-6 3.7 1.5-6.4-5-4.3 6.6-.5z"/></svg></div>
        </div>
      </div>
    </div>
    <div class="cap">&#9313;「<b>ホーム画面に追加</b>」を選ぶ</div>
  </div>
  <div class="arw">&rarr;</div>
  <div class="fig">
    <div class="iph"><div class="notch"></div>
      <div class="stat"><span>9:41</span><span class="r">&#9679;&#9679;&#9679; &#128246;</span></div>
      <div class="addbar"><span class="c">キャンセル</span><span class="t">ホーム画面に追加</span><span class="hl ok" style="padding:1px 6px;">追加</span></div>
      <div class="addbody">
        <span class="aicon"><span class="tri" style="width:22px;height:20px;">${TRI}</span></span>
        <span class="aname">KAWAI CAMP</span>
      </div>
      <div class="page" style="padding-top:2px;"><div class="ln s" style="width:40%"></div></div>
    </div>
    <div class="cap">&#9314; 右上の「<b>追加</b>」をタップ</div>
  </div>
</div>`;

const AND = `
<div class="flow">
  <div class="fig">
    <div class="and">
      <div class="crbar"><div class="cromni"><svg style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>kawaicamp-portal.com</div><span class="hl crmenu" style="padding:0 3px;">&#8942;</span></div>
      <div class="page"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div><div class="ln s"></div></div>
    </div>
    <div class="cap">&#9312; 右上の<b>メニュー &#8942;</b> をタップ</div>
  </div>
  <div class="arw">&rarr;</div>
  <div class="fig">
    <div class="and">
      <div class="crbar"><div class="cromni">kawaicamp-portal.com</div><span class="crmenu">&#8942;</span></div>
      <div class="crmenu-sheet">
        <div class="crmi"><svg viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>新しいタブ</div>
        <div class="crmi"><svg viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M12 7v5l3 2"/></svg>履歴</div>
        <div class="crmi"><svg viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 21h14"/></svg>ダウンロード</div>
        <div class="crmi tgt"><svg viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v6M9 11l3 3 3-3"/></svg>アプリをインストール</div>
        <div class="crmi"><svg viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 0 0-.2-1.8l1.8-1.4-2-3.4-2.1 1a8 8 0 0 0-1.6-.9L14.4 3H9.6L9.1 5.5a8 8 0 0 0-1.6.9l-2.1-1-2 3.4 1.8 1.4A8 8 0 0 0 5 12"/></svg>設定</div>
      </div>
    </div>
    <div class="cap">&#9313;「<b>アプリをインストール</b>」を選ぶ</div>
  </div>
  <div class="arw">&rarr;</div>
  <div class="fig">
    <div class="and">
      <div class="crbar"><div class="cromni">kawaicamp-portal.com</div><span class="crmenu">&#8942;</span></div>
      <div class="page" style="opacity:.4"><div class="ln m"></div><div class="ln s"></div></div>
      <div class="anddlg">
        <div class="row"><span class="aicon" style="width:34px;height:34px;"><span class="tri" style="width:18px;height:16px;">${TRI}</span></span><div style="font-size:11px;font-weight:700;">KAWAI CAMP をインストール</div></div>
        <div class="btns"><span style="color:#5f6368;">キャンセル</span><span class="hl" style="color:#1a73e8;padding:1px 6px;">インストール</span></div>
      </div>
    </div>
    <div class="cap">&#9314;「<b>インストール</b>」をタップ</div>
  </div>
</div>`;

const PC = `
<div class="flow" style="gap:14px;">
  <div class="fig" style="width:auto;">
    <div class="pc">
      <div class="pctab"><span class="tabm"><span class="tri" style="width:11px;height:10px;">${TRI}</span>KAWAI CAMP</span><span class="plus">+</span></div>
      <div class="pcomni"><span style="color:#5f6368">&#8592;&nbsp;&#8594;&nbsp;&#8635;</span><div class="pcurl"><svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>kawaicamp-portal.com</div><span class="hl installico"><svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="#ee1c25" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 7v6M9 10l3 3 3-3"/></svg></span></div>
      <div class="pcbody"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div>
    </div>
    <div class="cap" style="width:340px;">&#9312; アドレスバー右の<b>インストール</b>アイコンをクリック</div>
  </div>
  <div class="arw" style="padding-top:60px;">&rarr;</div>
  <div class="fig" style="width:auto;">
    <div class="popcard">
      <div class="row"><span class="aicon" style="width:34px;height:34px;"><span class="tri" style="width:18px;height:16px;">${TRI}</span></span><div style="font-size:12px;font-weight:700;">アプリをインストールしますか？<div style="font-size:10px;color:#5f6368;font-weight:400;">KAWAI CAMP</div></div></div>
      <div class="btns"><span class="btnsm gray">キャンセル</span><span class="btnsm blue hl">インストール</span></div>
    </div>
    <div class="cap" style="width:250px;">&#9313;「<b>インストール</b>」をクリック</div>
  </div>
  <div class="arw" style="padding-top:60px;">&rarr;</div>
  <div class="fig" style="width:auto;">
    <div class="pc" style="width:250px;">
      <div class="pctab" style="background:#1f2937;padding:6px 10px;align-items:center;"><span class="tri" style="width:12px;height:11px;">${TRI}</span><span style="color:#fff;font-size:10px;font-weight:700;margin-left:8px;">KAWAI CAMP</span></div>
      <div class="pcbody" style="height:80px;"><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div>
    </div>
    <div class="cap" style="width:250px;">&#9314; <b>アプリとして起動</b>（独立ウィンドウ）</div>
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
