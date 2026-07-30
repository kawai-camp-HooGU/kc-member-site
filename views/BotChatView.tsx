"use client";
// ============================================================
// チャットボット（ポータル内・会員）
//   親メニュー「ボット」→ 子「チャットボット」で表示するビュー。
//   共通 <BotChat> をポータル用バリアントで表示する。
// ============================================================
import { BotChat } from "../components/bot/BotChat";

export function BotChatView() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-gray-900">チャットボット</h1>
        <p className="text-xs text-gray-500">KAWAI-CAMPのナレッジから回答します。ログインの有無に関わらずご利用いただけます。</p>
      </div>
      <BotChat variant="portal" />
    </div>
  );
}
