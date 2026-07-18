// ============================================================
// 汎用AIチャット（別タブ・サイドバーなし）
//   /ops/ai-chat?mode=...&h=<token>
//   (console) グループの外なので App の殻（サイドバー）は付かない。
//   ops ゾーンなので middleware の IP 制限・運営ロール判定が効く。
// ============================================================
import { AiChatConsole } from "../../../components/ai/AiChatConsole";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AIチャット | KAWAI CAMP",
  robots: { index: false, follow: false },
};

export default function AiChatPage() {
  return <AiChatConsole />;
}
