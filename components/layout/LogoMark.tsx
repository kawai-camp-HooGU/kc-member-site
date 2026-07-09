// ブランドロゴアイコン（KAWAI CAMP：赤い三角＋スキップバック）
export function LogoMark({ box = "w-8 h-8" }: { box?: string; icon?: string }) {
  return (
    <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className={`${box} shrink-0`}>
      <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
      <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
      <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
    </svg>
  );
}
