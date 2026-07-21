// ============================================================
// 公開フォーム（/f/[slug]）のブランドヘッダー
//   ・コンテンツ公開ページ（PublicContent）と同じ黒帯だが、
//     フォームは未ログインの外部の方が最初に踏む画面になることが多いため、
//     ロゴを中央揃えにして一回り大きく出す（Mサイズ：SP 36px / PC 52px）。
//   ・リンクは張らない。回答の途中で離脱させないため。
//   ⚠️ "use client" は付けない。サーバーコンポーネント（page.tsx の
//      「フォームが見つかりません」画面）からも同じものを使うため。
// ============================================================
import { LogoMark } from "../layout/LogoMark";

export function PublicFormHeader() {
  return (
    <header className="bg-neutral-900 border-b border-neutral-800">
      <div className="px-5 py-4 sm:py-6 flex items-center justify-center gap-2.5 sm:gap-3.5">
        <LogoMark box="w-9 h-9 sm:w-[52px] sm:h-[52px]" />
        <span className="text-[19px] sm:text-[26px] font-bold tracking-wide text-white leading-none">
          KAWAI CAMP
        </span>
      </div>
    </header>
  );
}
