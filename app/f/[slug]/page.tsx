import type { Metadata } from "next";
import { loadFormBySlug } from "../../../lib/formsServer";
import { PublicForm } from "../../../components/form/PublicForm";
import { PublicFormHeader } from "../../../components/form/PublicFormHeader";

export const dynamic = "force-dynamic";

interface Props { params: { slug: string } }

/**
 * URLのパスパラメータをデコードする。
 *   slug に日本語（例：kawaicampポータル体験版）を使うと、ブラウザは
 *   %E3%83%9D… とパーセントエンコードして送ってくる。
 *   そのまま DB を検索すると一致せず「フォームが見つかりません」になるため、
 *   ここで必ずデコードする。（不正なエンコードなら元の文字列を使う）
 */
function decodeSlug(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = await loadFormBySlug(decodeSlug(params.slug)).catch(() => null);
  return { title: form ? `${form.title || form.name}｜KAWAI CAMP` : "フォーム｜KAWAI CAMP" };
}

export default async function FormPage({ params }: Props) {
  const form = await loadFormBySlug(decodeSlug(params.slug)).catch(() => null);

  if (!form || form.status === "draft") {
    // 見つからないときも同じブランドヘッダーを出す。URLを踏んだ方が
    // 「別サイトに飛ばされた」と感じないようにするため。
    return (
      <div className="min-h-screen bg-gray-100">
        <PublicFormHeader />
        <div className="flex items-center justify-center px-6 py-20">
          <div className="bg-white border border-gray-200 rounded-2xl px-8 py-10 text-center max-w-sm">
            <p className="text-sm font-bold text-gray-800 mb-1">フォームが見つかりません</p>
            <p className="text-[12.5px] text-gray-500">URLをご確認ください。公開が終了している場合もあります。</p>
          </div>
        </div>
      </div>
    );
  }

  return <PublicForm form={form} />;
}
