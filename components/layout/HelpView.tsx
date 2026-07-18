"use client";
import { Icon } from "../common/Icon";

// ヘルプ画面（操作マニュアル資料のダウンロード ＋ 初期設定ガイドへの入口）
export function HelpView({ onOpen }: { onOpen?: (k: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-red-600 text-xl leading-none">?</span>
        <h1 className="text-lg font-bold text-gray-800">ヘルプ</h1>
      </div>
      <p className="text-xs text-gray-500 mb-6">操作マニュアルのダウンロードや、使い方の確認ができます。</p>

      {/* 初期設定ガイドへの入口 */}
      {onOpen && (
        <button onClick={() => onOpen("tutorial")}
          className="w-full text-left flex items-center gap-3.5 bg-white border border-red-100 border-l-4 border-l-red-600 rounded-xl px-4 py-4 mb-6 max-w-2xl hover:shadow-md transition-all">
          <span className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Icon name="settings" size={22} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-gray-800">初期設定ガイド</span>
            <span className="block text-xs text-gray-500 mt-0.5">アプリのインストール方法と、通知をオンにする手順を図解で確認できます。</span>
          </span>
          <span className="ml-auto text-red-600 shrink-0 text-lg">›</span>
        </button>
      )}

      <p className="text-xs text-gray-400 mt-2 max-w-2xl">ご不明な点は管理者までお問い合わせください。</p>
    </div>
  );
}
