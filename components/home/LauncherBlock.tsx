"use client";
// ============================================================
// ショートカット行「いつもの場所へ」（REQ-094）
//
//   改修前の大タイル（高さ約160px×4枚）を、コンパクトな6枚の行に置き換えたもの。
//   バッジ（未視聴7・未読2・未回答1）は残すので、迷わなさは落ちない。
//
//   ⚠️ 初期設定タイルのロジック（showSetup / setupDone）は
//      REQ-091 が実装中のため、一字も変えずにここへ移設している。
//      直す必要が出たら REQ-091 側の変更を正として取り込むこと。
// ============================================================
import { useEffect, useState } from "react";
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import { isSubscribed, hasAccountSubscription } from "../../lib/push";
import { HOME_SECTION, HOME_RAIL_HEAD, HOME_RAIL_TITLE } from "../../lib/constants";
import type { HomeBlock } from "../../lib/models";

export interface LauncherBlockProps {
  block: HomeBlock;
  myId: number | null;
  can: (feature: string) => boolean;
  /** 未視聴コンテンツ数 */
  unviewed: number;
  /** チャット未読数（app.tsx の useChatUnread） */
  chatUnread: number;
  /** 未回答フォーム数と、その先頭の slug */
  openForms: number;
  firstFormSlug: string | null;
  onOpen: (viewKey: string) => void;
}

interface Item {
  key: string;
  icon: IconName;
  label: string;
  badge?: number;
  tone: "red" | "gray";
  onClick: () => void;
}

export function LauncherBlock({
  block: b, myId, can, unviewed, chatUnread, openForms, firstFormSlug, onOpen,
}: LauncherBlockProps) {
  // 初期設定カード（REQ-091 と同じ判定。ロジックを変えないこと）
  //   ・この端末が購読済み             → 出さない
  //   ・別端末で登録済み（設定済みの人）→ 出すが「まだ設定していません」とは言わない
  //   ・どこにも登録がない             → 未設定として出す
  const [showSetup, setShowSetup] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  useEffect(() => {
    (async () => {
      let deviceOk = false;
      try { deviceOk = await isSubscribed(); } catch { deviceOk = false; }
      if (deviceOk) { setShowSetup(false); setSetupDone(true); return; }
      const acct = myId != null ? await hasAccountSubscription(myId) : false;
      setSetupDone(acct);
      setShowSetup(true);
    })();
  }, [myId]);

  const items: Item[] = [];
  if (can("content")) {
    items.push({ key: "content", icon: "content", label: "コンテンツ", tone: "red",
      badge: unviewed, onClick: () => onOpen("content") });
  }
  if (can("calendar")) {
    items.push({ key: "calendar", icon: "calendar", label: "カレンダー", tone: "gray",
      onClick: () => onOpen("calendar") });
  }
  if (can("chat")) {
    items.push({ key: "chat", icon: "chat", label: "チャット", tone: "gray",
      badge: chatUnread, onClick: () => onOpen("chat") });
  }
  // 申込・回答はカレンダー連携フォームなので、カレンダーがONのロールにだけ出す
  if (can("calendar") && firstFormSlug) {
    items.push({ key: "form", icon: "form", label: "申込・回答", tone: "red",
      badge: openForms,
      onClick: () => window.open(`/f/${firstFormSlug}`, "_blank", "noopener") });
  }
  if (showSetup) {
    items.push({ key: "tutorial", icon: "settings", label: "初期設定",
      tone: setupDone ? "gray" : "red", onClick: () => onOpen("tutorial") });
  }
  if (can("help")) {
    items.push({ key: "help", icon: "help", label: "使い方", tone: "gray",
      onClick: () => onOpen("help") });
  }

  if (items.length === 0) return null;

  return (
    <section className={HOME_SECTION}>
      {b.title && (
        <div className={HOME_RAIL_HEAD}>
          <h2 className={HOME_RAIL_TITLE} style={{ wordBreak: "auto-phrase" }}>{b.title}</h2>
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {items.map((it) => (
          <button key={it.key} onClick={it.onClick}
            className="relative bg-white border border-gray-200 rounded-[10px] px-2 py-3
                       text-center hover:border-gray-300 hover:shadow-sm transition-all">
            {it.badge != null && it.badge > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-[18px] h-[18px] px-1 rounded-full
                               bg-red-600 text-white text-[11px] font-black
                               flex items-center justify-center">
                {it.badge > 99 ? "99+" : it.badge}
              </span>
            )}
            <span className={`w-8 h-8 rounded-lg mx-auto mb-1.5 flex items-center justify-center
                              ${it.tone === "red" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>
              <Icon name={it.icon} size={17} />
            </span>
            <span className="block text-[13px] font-bold text-gray-800 leading-snug">{it.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
