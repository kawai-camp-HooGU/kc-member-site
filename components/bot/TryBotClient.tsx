"use client";
// ============================================================
// 体験版チャット（独立ページ /try/[token]）— C系ダーク
//   ・ブランドヘッダは BotChat(standalone) が描画するため、ここでは付けない。
//   ・パスコード入力と参加導線フッターだけを付与する。
//   ・体験シナリオ（REQ-067）が設定されていれば、会話の上に体験レーンを差し込む。
//     設定されていなければ TrialLane 側が何も描かず、従来どおりのQ&Aチャットになる。
// ============================================================
import { useCallback, useState } from "react";
import { BotChat } from "./BotChat";
import { TrialLane } from "./trial/TrialLane";

export function TryBotClient({ token }: { token: string }) {
  const [passcode, setPasscode] = useState("");
  const [applied, setApplied] = useState(false);
  const [meter, setMeter] = useState<string | null>(null);
  // 体験シナリオが載っているか。TrialLane が読み込んだ時点で分かる。
  const [hasScenario, setHasScenario] = useState(false);

  // ⚠️ BotChat へ渡す関数は毎回作り直さない（TrialLane の useEffect が回り続ける）
  const onRemainingChange = useCallback((v: { gen: number; revise: number } | null) => {
    setMeter(v == null ? null : `あなたの残り　作成 ${v.gen} 回 ／ 調整 ${v.revise} 回`);
  }, []);
  const onScenarioLoaded = useCallback(() => setHasScenario(true), []);

  const activePasscode = applied ? (passcode || null) : null;

  return (
    <div className="h-[100dvh] bg-[#0b0a0a] text-[#f3efe8] flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 w-full mx-auto flex flex-col p-3 gap-2">
        {!applied && (
          <div className="shrink-0 flex items-center gap-2 text-xs text-[#a8a196]">
            <span>パスコードが設定されている場合は入力：</span>
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)}
              className="w-32 bg-[#161513] border border-[#37342f] rounded-lg px-2 py-1 text-sm text-[#f3efe8]" placeholder="任意" />
            <button onClick={() => setApplied(true)} className="text-[#ff9ea2] font-bold">適用</button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <BotChat variant="standalone" shareToken={token} passcode={activePasscode}
            // ⚠️ 体験シナリオが載っているときは挨拶もクイック質問も出さない。
            //    先頭に来るべきなのは体験の説明カードで、
            //    「何でも聞いてください」と並ぶと、何をする画面なのかが割れる。
            greeting={hasScenario ? null : "KAWAI CAMPへようこそ。気になることを何でも聞いてください。"}
            suggestions={hasScenario ? [] : undefined}
            meterNote={meter}
            trialSlot={
              <TrialLane
                shareToken={token}
                passcode={activePasscode}
                onRemainingChange={onRemainingChange}
                onScenarioLoaded={onScenarioLoaded}
              />
            } />
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
