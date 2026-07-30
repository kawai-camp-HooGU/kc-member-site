"use client";
// ============================================================
// 体験版チャット（独立ページ /try/[token] のクライアント本体）
//   ・ポータルのシェルを伴わない独立レイアウト。ログイン不要。
//   ・共通 <BotChat> を standalone バリアントで表示し、shareToken を渡す。
// ============================================================
import { useState } from "react";
import { BotChat } from "./BotChat";

export function TryBotClient({ token }: { token: string }) {
  const [passcode, setPasscode] = useState("");
  const [applied, setApplied] = useState(false);

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col">
      {/* ブランドバー */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <span className="text-base font-bold text-gray-900">🏕️ KAWAI-CAMP</span>
        <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">🎟️ 体験版</span>
        <a href="/login" className="ml-auto text-xs font-bold text-red-700 border border-red-200 rounded-full px-3 py-1 hover:bg-red-50">ログイン</a>
      </header>

      {/* 本体 */}
      <main className="flex-1 min-h-0 w-full max-w-2xl mx-auto flex flex-col p-3 gap-2">
        {/* パスコード（設定されている体験版のみ必要） */}
        {!applied && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>パスコードが設定されている場合は入力：</span>
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)}
              className="w-32 border border-gray-300 rounded-lg px-2 py-1 text-sm" placeholder="任意" />
            <button onClick={() => setApplied(true)} className="text-red-700 font-bold">適用</button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <BotChat variant="standalone" shareToken={token} passcode={passcode || null}
            greeting="KAWAI-CAMPへようこそ！気になることを何でも聞いてください🏕️" />
        </div>
      </main>

      {/* 参加導線 */}
      <footer className="shrink-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3 text-xs text-gray-500">
        <span>© KAWAI-CAMP</span>
        <a href="/login" className="ml-auto bg-emerald-700 text-white rounded-full px-4 py-1.5 font-bold hover:bg-emerald-800">
          ▶ 参加してもっと使う
        </a>
      </footer>
    </div>
  );
}
