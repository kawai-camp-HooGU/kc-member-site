"use client";
// ============================================================
// 体験版チャット（独立ページ /try/[token]）— C系ダーク
//   ・ブランドヘッダは BotChat(standalone) が描画するため、ここでは付けない。
//   ・パスコード入力と参加導線フッターだけを付与する。
// ============================================================
import { useState } from "react";
import { BotChat } from "./BotChat";

export function TryBotClient({ token }: { token: string }) {
  const [passcode, setPasscode] = useState("");
  const [applied, setApplied] = useState(false);

  return (
    <div className="h-[100dvh] bg-[#0b0a0a] text-[#f3efe8] flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 w-full max-w-3xl mx-auto flex flex-col p-3 gap-2">
        {!applied && (
          <div className="shrink-0 flex items-center gap-2 text-xs text-[#a8a196]">
            <span>パスコードが設定されている場合は入力：</span>
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)}
              className="w-32 bg-[#161513] border border-[#37342f] rounded-lg px-2 py-1 text-sm text-[#f3efe8]" placeholder="任意" />
            <button onClick={() => setApplied(true)} className="text-[#ff9ea2] font-bold">適用</button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <BotChat variant="standalone" shareToken={token} passcode={passcode || null}
            greeting="KAWAI CAMPへようこそ。気になることを何でも聞いてください。" />
        </div>
      </main>
      <footer className="shrink-0 bg-[#141312] border-t border-[#2b2926] px-4 py-3 flex items-center gap-3 text-xs text-[#a8a196]">
        <span>© KAWAI CAMP</span>
        <a href="/login" className="text-[#ff9ea2] font-bold">ログイン</a>
        <a href="/login" className="ml-auto bg-[#ee1c25] text-white rounded-full px-4 py-1.5 font-bold hover:brightness-110">参加してもっと使う</a>
      </footer>
    </div>
  );
}
