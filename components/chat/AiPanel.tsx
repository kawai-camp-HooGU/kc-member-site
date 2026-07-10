"use client";
// 右カラム：AI回答案＋壁打ち。★今回はUIのみ（生成は行わない）。
// 「採用」ボタンのみ機能し、案の文面を入力欄へ差し込む。

const DRAFTS: { label: string; tone: string; text: string }[] = [
  { label: "案 A", tone: "丁寧・安心重視", text: "お問い合わせありがとうございます😊 ご案内いたしますね。ご不明点があればいつでもご連絡ください！" },
  { label: "案 B", tone: "簡潔・スピード", text: "ありがとうございます！こちらの通りです🙌 よろしくお願いします。" },
  { label: "案 C", tone: "気配り・先回り", text: "ご連絡ありがとうございます。念のため補足しますね。少しでも不安な点があればお気軽にどうぞ😊" },
];

export interface AiPanelProps { onAdopt: (text: string) => void; }

export function AiPanel({ onAdopt }: AiPanelProps) {
  return (
    <div className="w-[340px] shrink-0 flex flex-col bg-white border-l border-gray-200 h-full">
      <div className="px-4 py-3 border-b border-gray-200 bg-red-50">
        <h2 className="text-sm font-extrabold flex items-center gap-2">✦ AI回答案 <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">準備中</span></h2>
        <p className="text-[11.5px] text-gray-500 mt-0.5">過去のやり取り・社内ナレッジ・Web検索をもとに自動生成（AI連携は今後実装）</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-[11px] text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2.5 mb-3">
          <b className="text-gray-700">参照する情報源（予定）</b>
          <div className="mt-1 flex flex-wrap gap-1">
            {["💬 このメンバーとの履歴", "📘 プロジェクト情報", "📚 社内ナレッジ", "🌐 Web検索"].map((c) => (
              <span key={c} className="inline-block bg-white border border-gray-200 rounded-full px-2 py-0.5 text-[10.5px]">{c}</span>
            ))}
          </div>
        </div>
        {DRAFTS.map((d) => (
          <div key={d.label} className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <span className="font-extrabold text-xs">{d.label}</span>
              <span className="text-[10.5px] text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">{d.tone}</span>
            </div>
            <div className="px-3 py-2.5 text-xs whitespace-pre-wrap text-gray-700">{d.text}</div>
            <div className="flex gap-1.5 px-3 pb-2.5">
              <button onClick={() => onAdopt(d.text)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white">この案を採用</button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 bg-red-50 px-3.5 py-3 shrink-0">
        <div className="text-[11px] text-gray-500 font-bold mb-2">✦ AIと壁打ち（文面の相談・添削）</div>
        <div className="flex gap-2">
          <input disabled placeholder="（AI連携は後日）相談・修正指示"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white/60 cursor-not-allowed" />
          <button disabled className="px-3.5 rounded-lg bg-red-300 text-white font-bold text-sm cursor-not-allowed">送信</button>
        </div>
        <div className="text-[10.5px] text-gray-400 text-center pt-2">採用 → 入力欄に反映 → 人の手で最終送信</div>
      </div>
    </div>
  );
}
