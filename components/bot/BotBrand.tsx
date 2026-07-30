// ============================================================
// KAWAI BRAIN AI ロゴタイプ（テック・フューチャー / Orbitron）
//   ・ヘッダー等で使う共通ワードマーク。BRAIN をコンセプトレッド(#ee1c25)。
//   ・サブコピー「THINK LIKE KAWAI.」。フォントは app/layout.tsx で読込。
// ============================================================
const FONT = "'Orbitron', system-ui, sans-serif";

export function BotBrand({
  variant = "light",
  showSub = true,
  size = 15,
}: {
  variant?: "light" | "dark";
  showSub?: boolean;
  size?: number;
}) {
  const primary = variant === "dark" ? "#f3efe8" : "#1c1b19";
  const subc = variant === "dark" ? "#a8a196" : "#9a948a";
  return (
    <div className="min-w-0 leading-tight">
      <div className="flex items-baseline gap-1.5" style={{ fontFamily: FONT, letterSpacing: "0.06em" }}>
        <span className="font-bold" style={{ fontSize: size, color: primary }}>KAWAI</span>
        <span className="font-black" style={{ fontSize: size, color: "#ee1c25" }}>BRAIN</span>
        <span className="font-bold" style={{ fontSize: size, color: primary }}>AI</span>
      </div>
      {showSub && (
        <div className="mt-0.5" style={{ fontFamily: FONT, fontSize: 9, color: subc, letterSpacing: "0.2em" }}>
          THINK LIKE KAWAI.
        </div>
      )}
    </div>
  );
}
