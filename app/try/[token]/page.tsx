// ============================================================
// /try/[token] — 体験版チャット（公開・ログイン不要）
//   ・middleware は /try/ を公開ゾーン扱い（lib/zone.ts PUBLIC_PREFIXES）。
//   ・トークンの有効性（期限・失効・累計・パスコード）は /api/bot 側で検証する。
// ============================================================
import { TryBotClient } from "../../../components/bot/TryBotClient";

export const metadata = {
  title: "KAWAI-CAMP 体験版チャット",
  robots: { index: false, follow: false },
};

export default function TryPage({ params }: { params: { token: string } }) {
  return <TryBotClient token={params.token} />;
}
