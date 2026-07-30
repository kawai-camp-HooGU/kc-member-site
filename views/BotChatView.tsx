"use client";
// ============================================================
// チャットボット（ポータル内・会員）
//   親メニュー「ボット」→ 子「チャットボット」で表示するビュー。
//   共通 <BotChat> をポータル用バリアントで表示する。
// ============================================================
import { BotChat } from "../components/bot/BotChat";
import { useRoute } from "../hooks/useRoute";

export function BotChatView() {
  const route = useRoute();
  return (
    <div className="space-y-2">
      <BotChat variant="portal" onSettings={() => route.go("bot-settings")} />
    </div>
  );
}
